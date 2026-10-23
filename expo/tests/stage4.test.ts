import { describe, expect, test } from "bun:test";
import { readXlsx, base64ToBytes } from "../lib/vendor/xlsx-lite";
import { bytesToBase64, colName, writeXlsx } from "../src/files/xlsx-write";
import { buildRegister } from "../src/domain/register";
import { classifyResponse, classifySheet, scoreAgainstKey, OMR_THRESHOLDS } from "../src/domain/omr";
import { resolveZones, selectTemplate } from "../src/domain/templates";
import { completeExport, exportableEntries, failExport, markExported, planExport } from "../src/domain/export-jobs";
import type { PaperTemplate } from "../src/domain/models";
import type { ImportedFile } from "../src/files/adapter";

// --- .xlsx writer: verified by reading back with the real reader -------------

describe("xlsx-write roundtrip", () => {
  test("write → read returns the same cells (strings, numbers, unicode)", () => {
    const bytes = writeXlsx([
      {
        name: "Register",
        rows: [
          ["Student", "Quiz 1", "Total"],
          ["Amina Juma", "34/50", 84],
          ["Zoë O'Brien", "28/50", 56],
          ["العربية 中文", 0.5, -12],
        ],
      },
    ]);
    const sheets = readXlsx(bytes);
    expect(sheets.length).toBe(1);
    expect(sheets[0].name).toBe("Register");
    expect(sheets[0].rows[0]).toEqual(["Student", "Quiz 1", "Total"]);
    expect(sheets[0].rows[1]).toEqual(["Amina Juma", "34/50", "84"]);
    expect(sheets[0].rows[2]).toEqual(["Zoë O'Brien", "28/50", "56"]);
    expect(sheets[0].rows[3][0]).toBe("العربية 中文");
  });

  test("text is written verbatim — register numbers keep their leading zeros", () => {
    const sheets = readXlsx(
      writeXlsx([{ name: "S", rows: [["84", 84], ["0042", 42], ["34/50", "x"]] }]),
    );
    expect(sheets[0].rows[0]).toEqual(["84", "84"]); // text "84" stays text
    expect(sheets[0].rows[1]).toEqual(["0042", "42"]); // NOT coerced to 42
    expect(sheets[0].rows[2]).toEqual(["34/50", "x"]);
  });

  test("multiple sheets roundtrip in order", () => {
    const sheets = readXlsx(
      writeXlsx([
        { name: "Marks", rows: [["a"]] },
        { name: "OMR", rows: [["b", 2]] },
      ]),
    );
    expect(sheets.map((s) => s.name)).toEqual(["Marks", "OMR"]);
    expect(sheets[1].rows[0]).toEqual(["b", "2"]);
  });

  test("illegal/empty sheet names are sanitized; unnamed sheets rejected", () => {
    const sheets = readXlsx(
      writeXlsx([
        { name: "bad:name*here", rows: [["x"]] },
        { name: "bad:name*here", rows: [["y"]] }, // duplicate → suffixed
      ]),
    );
    expect(sheets[0].name).not.toContain(":");
    expect(sheets[0].name).not.toContain("*");
    expect(sheets[1].name).not.toBe(sheets[0].name);
    expect(() => writeXlsx([{ name: "///", rows: [["x"]] }])).toThrow("XLSX_BAD_SHEET");
    expect(() => writeXlsx([])).toThrow("XLSX_BAD_SHEET");
  });

  test("base64 output decodes back to the same bytes", () => {
    const bytes = writeXlsx([{ name: "S", rows: [["x", 1]] }]);
    const back = base64ToBytes(bytesToBase64(bytes));
    expect(Array.from(back)).toEqual(Array.from(bytes));
  });

  test("colName is the inverse of the reader's colToIndex", () => {
    expect(colName(0)).toBe("A");
    expect(colName(25)).toBe("Z");
    expect(colName(26)).toBe("AA");
    expect(colName(701)).toBe("ZZ");
  });
});

// --- Register builder ---------------------------------------------------------

const roster = [
  { name: "Amina Juma", ref: "R001" },
  { name: "Baraka Otieno", ref: "R002" },
  { name: "Cynthia Mwale", ref: "R003" },
];

const entries = [
  { studentName: "Amina Juma", assessment: "Quiz 1", mark: 34, maxMark: 50, status: "confirmed" },
  { studentName: "Amina Juma", assessment: "Quiz 2", mark: 40, maxMark: 50, status: "confirmed" },
  { studentName: "Baraka Otieno", assessment: "Quiz 1", mark: 20, maxMark: 50, status: "confirmed" },
  { studentName: "Baraka Otieno", assessment: "Quiz 2", mark: 10, maxMark: 50, status: "pending" }, // excluded
  { studentName: "Zuri Ali", assessment: "Quiz 1", mark: 48, maxMark: 50, status: "confirmed" }, // not on roster
];

const all = { includeRef: true, includeTotal: true, includePercent: true };

describe("register builder", () => {
  test("exports ONLY confirmed entries; excluded are counted, never silent", () => {
    const reg = buildRegister(entries, roster, all);
    expect(reg.excludedCount).toBe(1);
    expect(reg.excludedIn).toEqual(["Quiz 2"]);
    const baraka = reg.rows.find((r) => r[0] === "Baraka Otieno")!;
    expect(baraka).not.toContain("10/50"); // pending mark absent
  });

  test("roster order first, unmatched students appended and listed", () => {
    const reg = buildRegister(entries, roster, all);
    expect(reg.rows.map((r) => r[0])).toEqual(["Amina Juma", "Baraka Otieno", "Zuri Ali"]);
    expect(reg.unmatched).toEqual(["Zuri Ali"]);
  });

  test("columns follow the options exactly; max row sums the real maxes", () => {
    const reg = buildRegister(entries, roster, all);
    expect(reg.columns).toEqual(["Student", "Ref", "Quiz 1", "Quiz 2", "Total", "%"]);
    expect(reg.maxRow).toEqual(["Max", "", 50, 50, 100, ""]);
    expect(reg.rows[0]).toEqual(["Amina Juma", "R001", "34/50", "40/50", "74/100", 74]);
  });

  test("minimal options produce just names and assessments", () => {
    const reg = buildRegister(entries, roster, {
      includeRef: false,
      includeTotal: false,
      includePercent: false,
    });
    expect(reg.columns).toEqual(["Student", "Quiz 1", "Quiz 2"]);
    expect(reg.rows[0]).toEqual(["Amina Juma", "34/50", "40/50"]);
  });

  test("missing marks are empty cells, never zeros or guesses", () => {
    // Baraka's Quiz 2 is pending (excluded) while Amina's is confirmed, so the
    // Quiz 2 column exists — Baraka's cell there is genuinely empty.
    const reg = buildRegister(entries, roster, all);
    const baraka = reg.rows.find((r) => r[0] === "Baraka Otieno")!;
    expect(reg.columns[3]).toBe("Quiz 2");
    expect(baraka[3]).toBe(""); // excluded pending mark leaves an empty cell
  });

  test("register output round-trips through the xlsx writer", () => {
    const reg = buildRegister(entries, roster, all);
    const sheets = readXlsx(
      writeXlsx([{ name: "Register", rows: [reg.columns, reg.maxRow, ...reg.rows] }]),
    );
    expect(sheets[0].rows[0]).toEqual(reg.columns);
    expect(sheets[0].rows[2][0]).toBe("Amina Juma");
  });
});

// --- OMR classification + scoring --------------------------------------------

describe("OMR classification", () => {
  test("clean single fill", () => {
    const r = classifyResponse({ pageId: "p", question: 3, fills: [0.02, 0.91, 0.05] });
    expect(r.state).toBe("filled");
    expect(r.selected).toEqual([1]);
    expect(r.confidence).toBeGreaterThan(0.6);
  });

  test("clean blank", () => {
    const r = classifyResponse({ pageId: "p", question: 1, fills: [0.05, 0.1] });
    expect(r.state).toBe("blank");
    expect(r.selected).toEqual([]);
  });

  test("partial fill inside the ambiguity band is ambiguous, never scored", () => {
    const low = OMR_THRESHOLDS.blank + 0.1; // near the blank end of the band
    const r = classifyResponse({ pageId: "p", question: 2, fills: [low, 0.02] });
    expect(r.state).toBe("ambiguous");
    expect(r.confidence).toBeLessThan(0.5);
  });

  test("two strong fills are multiple — flagged with the top-first ordering", () => {
    const r = classifyResponse({ pageId: "p", question: 4, fills: [0.8, 0.95, 0.01] });
    expect(r.state).toBe("multiple");
    expect(r.selected).toEqual([1, 0]);
  });

  test("classifySheet preserves question order", () => {
    const rs = classifySheet([
      { pageId: "p", question: 7, fills: [0.9] },
      { pageId: "p", question: 8, fills: [0.01] },
    ]);
    expect(rs.map((r) => r.question)).toEqual([7, 8]);
  });
});

describe("OMR scoring against the teacher's key", () => {
  const key = { 1: [0], 2: [1], 3: [2, 3] };

  test("exact selection sets score; wrong selections do not", () => {
    const rs = classifySheet([
      { pageId: "p", question: 1, fills: [0.9, 0.02] }, // correct
      { pageId: "p", question: 2, fills: [0.9, 0.02] }, // wrong (expects B)
      // multi-select question: key expects 2 bubbles, both filled → credited
      { pageId: "p", question: 3, fills: [0.02, 0.02, 0.85, 0.9], selectable: 2 },
    ]);
    const s = scoreAgainstKey(rs, key);
    expect(s.credited).toBe(2);
    expect(s.keyed).toBe(3);
    expect(s.flaggedQuestions).toEqual([]);
  });

  test("more fills than the question allows is multiple, even if the key is multi-select", () => {
    const rs = classifySheet([
      { pageId: "p", question: 3, fills: [0.8, 0.02, 0.85, 0.9], selectable: 2 },
    ]);
    const s = scoreAgainstKey(rs, key);
    expect(s.flaggedQuestions).toEqual([3]);
    expect(s.credited).toBe(0);
  });

  test("multiple/ambiguous are flagged, never auto-scored", () => {
    const rs = classifySheet([
      { pageId: "p", question: 1, fills: [0.9, 0.85] }, // multiple incl. the keyed bubble
      { pageId: "p", question: 2, fills: [0.5, 0.02] }, // ambiguous
    ]);
    const s = scoreAgainstKey(rs, key);
    expect(s.credited).toBe(0);
    expect(s.flaggedQuestions).toEqual([1, 2]);
  });

  test("unkeyed questions are excluded, not counted wrong", () => {
    const rs = classifySheet([{ pageId: "p", question: 9, fills: [0.9] }]);
    const s = scoreAgainstKey(rs, key);
    expect(s.unkeyed).toBe(1);
    expect(s.keyed).toBe(0);
    expect(s.credited).toBe(0);
  });

  test("blank keyed response is a non-credit, not a flag", () => {
    const rs = classifySheet([{ pageId: "p", question: 1, fills: [0.01] }]);
    const s = scoreAgainstKey(rs, key);
    expect(s.credited).toBe(0);
    expect(s.flaggedQuestions).toEqual([]);
  });
});

// --- Paper-template selection --------------------------------------------------

const tmpl = (id: string, paperType: PaperTemplate["paperType"]): PaperTemplate => ({
  id,
  name: id,
  paperType,
  zones: { id: { x: 0.1, y: 0.1, w: 0.3, h: 0.1 } },
});

describe("template selection", () => {
  test("unique fiducial match selects the template", () => {
    const sel = selectTemplate([tmpl("A", "ordinary"), tmpl("B", "omr")], "A", "ordinary");
    expect(sel.ok).toBe(true);
    if (sel.ok) expect(sel.template.id).toBe("A");
  });

  test("unknown fiducial id → ask, never guess", () => {
    const sel = selectTemplate([tmpl("A", "omr")], "Z9", "omr");
    expect(sel).toEqual({
      ok: false,
      reason: "unknown_id",
      detail: 'detected "Z9" matches no configured template',
    });
  });

  test("no fiducial + several templates → teacher must choose", () => {
    const sel = selectTemplate([tmpl("A", "omr"), tmpl("B", "omr")], null, "omr");
    expect(sel.ok).toBe(false);
    if (!sel.ok) expect(sel.reason).toBe("none_detected");
  });

  test("no fiducial + exactly one configured template resolves it", () => {
    const sel = selectTemplate([tmpl("A", "ordinary")], null, "ordinary");
    expect(sel.ok).toBe(true);
  });

  test("duplicate template ids fail closed", () => {
    const sel = selectTemplate([tmpl("A", "omr"), tmpl("A", "omr")], "A", "omr");
    expect(sel.ok).toBe(false);
    if (!sel.ok) expect(sel.reason).toBe("multiple_candidates");
  });

  test("resolveZones maps template zones into the detected paper bounds; out-of-paper zones dropped", () => {
    const t = tmpl("A", "ordinary");
    t.zones = {
      id: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 },
      overflow: { x: 1.2, y: 0, w: 0.2, h: 0.1 }, // outside the paper
    };
    const z = resolveZones(t, { x: 0.1, y: 0.1, w: 0.5, h: 0.5 });
    expect(z!.id.x).toBeCloseTo(0.15, 10);
    expect(z!.id.y).toBeCloseTo(0.15, 10);
    expect(z!.id.w).toBeCloseTo(0.1, 10);
    expect(z!.id.h).toBeCloseTo(0.05, 10);
    expect(z!.overflow).toBeUndefined();
    expect(resolveZones(t, null)).toBeNull();
    expect(resolveZones(t, { x: 0, y: 0, w: 0, h: 0 })).toBeNull();
  });
});

// --- Export-job lifecycle -------------------------------------------------------

const source: ImportedFile = { name: "class4-register.xlsx", format: "xlsx", pickedAt: "2026-10-16T00:00:00Z" };
const now = () => "2026-10-16T09:00:00Z";

describe("export job lifecycle", () => {
  test("plan refuses a destination that would overwrite the source register", () => {
    const plan = planExport("j1", {
      format: "xlsx",
      desiredName: "class4-register.xlsx", // same as the imported source
      source,
      takenNames: () => false,
      now,
    });
    expect(plan.ok).toBe(false);
  });

  test("plan refuses names already taken, then suffixes to a unique new file", () => {
    const plan = planExport("j1", {
      format: "xlsx",
      desiredName: "term-report.xlsx",
      source: null,
      takenNames: (n) => n === "term-report.xlsx",
      now,
    });
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.job.outputRef).not.toBe("term-report.xlsx");
      expect(plan.job.status).toBe("pending");
    }
  });

  test("a completed job is completed only via completion after the file exists", () => {
    const plan = planExport("j2", {
      format: "xlsx",
      desiredName: "term-report.xlsx",
      source: null,
      takenNames: () => false,
      now,
    });
    if (!plan.ok) throw new Error("plan should succeed");
    expect(plan.job.status).toBe("pending");
    const done = completeExport(plan.job);
    expect(done.status).toBe("completed");
    const failed = failExport(plan.job, "SAF write denied");
    expect(failed.status).toBe("failed");
    expect(failed.failReason).toBe("SAF write denied");
  });

  test("only confirmed entries are exportable; marking happens after completion on copies", () => {
    const list = [
      { id: "1", status: "confirmed" },
      { id: "2", status: "pending" },
      { id: "3", status: "flagged" },
    ];
    const { included, excluded } = exportableEntries(list);
    expect(included.map((e) => e.id)).toEqual(["1"]);
    expect(excluded.map((e) => e.id)).toEqual(["2", "3"]);
    const marked = markExported(included);
    expect(marked[0].status).toBe("exported");
    expect(marked[0]).not.toBe(included[0]); // copy — caller replaces in store
    expect(included[0].status).toBe("confirmed"); // input untouched
  });
});
