import { describe, expect, test } from "bun:test";
import { parseCsv, writeCsv } from "../src/domain/csv";
import { sanitizeCellText, writeXlsx } from "../src/files/xlsx-write";
import { readXlsx } from "../lib/vendor/xlsx-lite";
import {
  filterClasses,
  findDuplicateClass,
  findDuplicateMatches,
  resolveDuplicate,
  validateAssessment,
  validateStudent,
} from "../src/domain/register-management";
import {
  MAX_IMPORT_BYTES,
  autoMap,
  buildImportPreview,
  canConfirm,
  detectHeaderRow,
  parseImportFile,
  planImport,
} from "../src/domain/import";
import { buildRegister } from "../src/domain/register";
import { bytesToBase64 } from "../src/files/xlsx-write";

// --- CSV reader/writer ---------------------------------------------------------

describe("CSV (RFC 4180)", () => {
  test("parses quotes, escaped quotes, commas, CRLF and LF", () => {
    const rows = parseCsv('a,"b,c",\r\n"say ""hi""",2\n"multi\nline",x');
    expect(rows).toEqual([
      ["a", "b,c", ""],
      ['say "hi"', "2"],
      ["multi\nline", "x"],
    ]);
  });

  test("trailing empty padding rows are dropped, interior empties kept", () => {
    expect(parseCsv("a,b\n1,2\n\n\n")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv("a,b\n\n1,2")).toEqual([["a", "b"], [""], ["1", "2"]]);
  });

  test("writer escapes and the reader round-trips", () => {
    const text = writeCsv(["Name", "Ref"], [["O'Brien, Pat", "R,001"], ['quote"man', 42]]);
    expect(parseCsv(text)).toEqual([["Name", "Ref"], ["O'Brien, Pat", "R,001"], ['quote"man', "42"]]);
  });
});

// --- Export sanitization ---------------------------------------------------------

describe("export sanitization", () => {
  test("formula-triggering text is prefixed, numbers untouched", () => {
    expect(sanitizeCellText("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(sanitizeCellText("+254722000000")).toBe("'+254722000000");
    expect(sanitizeCellText("-absent")).toBe("'-absent");
    expect(sanitizeCellText("@risk")).toBe("'@risk");
    expect(sanitizeCellText("Amina Juma")).toBe("Amina Juma");
    expect(sanitizeCellText("")).toBe("");
  });

  test("xlsx round-trip: formula text lands inert, marks stay numeric", () => {
    const bytes = writeXlsx([
      { name: "S", rows: [["Student", "Mark"], ["=SUM(A1)", 84], ["0042", 0]] },
    ]);
    const sheets = readXlsx(bytes);
    expect(sheets[0].rows[1][0]).toBe("'=SUM(A1)");
    expect(sheets[0].rows[1][1]).toBe("84");
    expect(sheets[0].rows[2][1]).toBe("0"); // zero stays a distinct value from ""
  });

  test("csv export sanitizes too", () => {
    const csv = writeCsv(["n", "m"], [["=cmd", 5]]);
    expect(csv).toContain("'=cmd");
  });
});

// --- Students ---------------------------------------------------------------

const roster: { id: string; classId: string; name: string; ref?: string }[] = [
  { id: "s1", classId: "c1", name: "Amina Juma", ref: "R001" },
  { id: "s2", classId: "c1", name: "Baraka Otieno" },
];

describe("student validation & duplicates", () => {
  test("required name; ref duplicate against the class roster is an error", () => {
    expect(validateStudent({ name: "" }, roster)).toEqual({ ok: false, field: "name", reason: "required" });
    expect(validateStudent({ name: "New Kid", ref: "r001" }, roster)).toEqual({
      ok: false,
      field: "ref",
      reason: "duplicate_ref",
    });
    expect(validateStudent({ name: "New Kid", ref: "R002" }, roster)).toEqual({ ok: true });
  });

  test("stable ref match is strong even if names differ", () => {
    const m = findDuplicateMatches({ name: "Amina Juma Said", ref: "r001" }, roster);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ existingId: "s1", reason: "same_ref" });
  });

  test("name-only match requires NEITHER record to carry a ref — never merges on name alone", () => {
    // Incoming has a ref, existing has none → no automatic match.
    expect(findDuplicateMatches({ name: "baraka otieno", ref: "R9" }, roster)).toEqual([]);
    // Neither has a ref → warning-level name match.
    const m = findDuplicateMatches({ name: "BARAKA   OTIENO" }, roster);
    expect(m).toHaveLength(1);
    expect(m[0].reason).toBe("same_name");
  });

  test("accent/case-insensitive identity", () => {
    expect(findDuplicateMatches({ name: "Báraka Otienó" }, roster)).toHaveLength(1);
  });

  test("resolution: skip drops incoming, update overwrites ONLY with explicit choice, keep_both keeps both", () => {
    expect(resolveDuplicate(roster[0], { name: "Amina Juma Said", ref: "R001" }, "skip")).toBeNull();
    expect(resolveDuplicate(roster[0], { name: "Amina Juma Said" }, "keep_both")).toBe("keep_both");
    const upd = resolveDuplicate(roster[0], { name: "Amina Juma Said", ref: "R001" }, "update");
    expect(upd).toEqual({ id: "s1", classId: "c1", name: "Amina Juma Said", ref: "R001" });
  });
});

// --- Classes & assessments -----------------------------------------------------

describe("class & assessment rules", () => {
  const classes = [
    { id: "c1", name: "Grade 4 Blue", subject: "Mathematics", grade: "4" },
    { id: "c2", name: "grade 4 blue", subject: "Math", grade: "4" },
  ];

  test("duplicate class rule: name + grade, case-insensitive", () => {
    expect(findDuplicateClass({ name: "GRADE 4 BLUE", grade: "4" }, classes)?.id).toBe("c1");
    expect(findDuplicateClass({ name: "Grade 4 Red", grade: "4" }, classes)).toBeNull();
  });

  test("class search spans name, subject and grade, accents ignored", () => {
    expect(filterClasses(classes, "math")).toHaveLength(2);
    expect(filterClasses(classes, "blue")).toHaveLength(2);
    expect(filterClasses(classes, "red")).toHaveLength(0);
  });

  test("assessment validation: required name, positive max, duplicate name in class", () => {
    expect(validateAssessment({ name: "", maxMark: 50 }, [])).toEqual({ ok: false, field: "name", reason: "required" });
    expect(validateAssessment({ name: "Quiz", maxMark: 0 }, [])).toEqual({ ok: false, field: "maxMark", reason: "not_positive" });
    expect(validateAssessment({ name: "Quiz", maxMark: -3 }, [])).toEqual({ ok: false, field: "maxMark", reason: "not_positive" });
    expect(validateAssessment({ name: "quiz 1", maxMark: 50 }, ["Quiz 1"])).toEqual({ ok: false, field: "name", reason: "duplicate" });
    expect(validateAssessment({ name: "Quiz 2", maxMark: 50 }, ["Quiz 1"])).toEqual({ ok: true });
  });
});

// --- Import engine ---------------------------------------------------------------

const existing = [
  { id: "s1", classId: "c1", name: "Amina Juma", ref: "R001" },
  { id: "s2", classId: "c1", name: "Baraka Otieno" },
];

function xlsxBytes(headers: string[], rows: string[][]): Uint8Array {
  return writeXlsx([{ name: "Sheet1", rows: [headers, ...rows] }]);
}

describe("import engine", () => {
  test("valid .xlsx import: auto-mapping, preview, clean plan", () => {
    const parsed = parseImportFile("register.xlsx", xlsxBytes(["Student Name", "Admission Number"], [["Amina Juma", "R001"], ["New Pupil", "R100"]]));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const preview = buildImportPreview({ rows: parsed.tables[0].rows, existing });
    expect(preview.headers).toEqual(["Student Name", "Admission Number"]);
    expect(preview.mapping).toEqual({ name: 0, ref: 1 });
    expect(preview.errorCount).toBe(0);
    // R001 matches the existing Amina by ref; the new pupil is clean.
    const plan = planImport(preview, new Map());
    expect(plan.creates).toEqual([{ name: "New Pupil", ref: "R100" }]);
    expect(plan.summary).toMatchObject({ totalRows: 2, validRows: 1, newStudents: 1, existingMatched: 1, duplicatesDetected: 1, skippedRows: 1, committed: 1 });
  });

  test("valid .csv import with different header spellings", () => {
    const csv = "Full Name,Registration No\nCynthia Mwale,R-77\n";
    const parsed = parseImportFile("list.csv", new TextEncoder().encode(csv));
    if (!parsed.ok) throw new Error("csv should parse");
    const preview = buildImportPreview({ rows: parsed.tables[0].rows, existing });
    expect(preview.mapping).toEqual({ name: 0, ref: 1 });
    expect(preview.errorCount).toBe(0);
    expect(planImport(preview, new Map()).creates).toEqual([{ name: "Cynthia Mwale", ref: "R-77" }]);
  });

  test("column mapping handles Candidate ID and whitespace/case variants", () => {
    expect(autoMap([" candidate id ", " Full Name "])).toEqual({ name: 1, ref: 0 });
    expect(autoMap(["Roll", "Pupil"])).toEqual({ name: 1, ref: 0 });
  });

  test("teacher-corrected mapping overrides wrong auto-mapping", () => {
    const parsed = parseImportFile("odd.xlsx", xlsxBytes(["Number", "Label"], [["R1", "Not A Name"], ["R2", "Real Name"]]));
    if (!parsed.ok) throw new Error("xlsx should parse");
    // Auto-map guesses wrong (Number col 0 as ref, Label col 1 as name? Label is not name-like → name=0).
    const corrected = buildImportPreview({ rows: parsed.tables[0].rows, existing, mapping: { name: 1, ref: 0 } });
    expect(corrected.records.map((r) => r.name)).toEqual(["Not A Name", "Real Name"]);
    expect(corrected.records[1].ref).toBe("R2");
  });

  test("missing required fields report the row number; empty padding rows are skipped", () => {
    const parsed = parseImportFile("r.xlsx", xlsxBytes(["Name", "ID"], [["", "R5"], ["Ok Kid", "R6"], [], ["", ""]]));
    if (!parsed.ok) throw new Error("parse");
    const preview = buildImportPreview({ rows: parsed.tables[0].rows, existing });
    expect(preview.totalRows).toBe(2); // padding rows excluded from totals
    const bad = preview.records.find((r) => r.row === 1)!;
    expect(bad.issues.some((i) => i.reason === "missing_name" && i.severity === "error")).toBe(true);
    expect(preview.errorCount).toBe(1);
  });

  test("duplicate refs within one file are errors naming the first row", () => {
    const parsed = parseImportFile("r.xlsx", xlsxBytes(["Name", "ID"], [["A One", "R5"], ["B Two", "R5"]]));
    if (!parsed.ok) throw new Error("parse");
    const preview = buildImportPreview({ rows: parsed.tables[0].rows, existing: [] });
    expect(preview.records[1].issues[0]).toMatchObject({ severity: "error", reason: "duplicate_ref_in_file", detail: "same registration number as data row 1" });
  });

  test("re-importing the same register creates NO duplicates (ref match defaults to skip)", () => {
    const parsed = parseImportFile("r.xlsx", xlsxBytes(["Name", "ID"], [["Amina Juma", "R001"]]));
    if (!parsed.ok) throw new Error("parse");
    const preview = buildImportPreview({ rows: parsed.tables[0].rows, existing });
    expect(canConfirm(preview, new Map())).toBe(true); // ref match auto-skips, no error
    const plan = planImport(preview, new Map());
    expect(plan.creates).toHaveLength(0);
    expect(plan.summary.existingMatched).toBe(1);
    expect(plan.summary.skippedRows).toBe(1);
  });

  test("existing-student name warnings (no refs anywhere) are warnings, not errors", () => {
    const db = [{ id: "s2", classId: "c1", name: "Baraka Otieno" }];
    const parsed = parseImportFile("r.csv", new TextEncoder().encode("Name\nbaraka otieno\n"));
    if (!parsed.ok) throw new Error("parse");
    const preview = buildImportPreview({ rows: parsed.tables[0].rows, existing: db });
    expect(preview.errorCount).toBe(0);
    expect(preview.warningCount).toBe(1);
    expect(preview.records[0].issues[0].reason).toBe("possible_existing_student");
    // Default keeps both — the teacher must explicitly choose otherwise.
    expect(planImport(preview, new Map()).creates).toHaveLength(1);
  });

  test("unresolved errors block confirmation; explicit skip unblocks and is counted", () => {
    const parsed = parseImportFile("r.xlsx", xlsxBytes(["Name", "ID"], [["", "R1"], ["Good", "R2"]]));
    if (!parsed.ok) throw new Error("parse");
    const preview = buildImportPreview({ rows: parsed.tables[0].rows, existing: [] });
    expect(canConfirm(preview, new Map())).toBe(false);
    const choices = new Map([[1, "skip" as const]]);
    expect(canConfirm(preview, choices)).toBe(true);
    const plan = planImport(preview, choices);
    // The bad row was explicitly skipped (so not invalid anymore); the good row commits.
    expect(plan.summary).toMatchObject({ skippedRows: 1, invalidRows: 0, newStudents: 1, committed: 1 });
  });

  test("ref reassignment (update) overwrites only on explicit choice", () => {
    const parsed = parseImportFile("r.xlsx", xlsxBytes(["Name", "ID"], [["Amina Juma Updated", "R001"]]));
    if (!parsed.ok) throw new Error("parse");
    const preview = buildImportPreview({ rows: parsed.tables[0].rows, existing });
    const plan = planImport(preview, new Map([[1, "update" as const]]));
    expect(plan.updates).toEqual([{ id: "s1", name: "Amina Juma Updated", ref: "R001" }]);
    expect(plan.summary.updated).toBe(1);
    expect(plan.summary.committed).toBe(1);
  });

  test("keep_both on a ref duplicate imports it as an explicit new record", () => {
    const parsed = parseImportFile("r.xlsx", xlsxBytes(["Name", "ID"], [["Amina Juma", "R001"]]));
    if (!parsed.ok) throw new Error("parse");
    const preview = buildImportPreview({ rows: parsed.tables[0].rows, existing });
    expect(canConfirm(preview, new Map([[1, "keep_both" as const]]))).toBe(true);
    expect(planImport(preview, new Map([[1, "keep_both" as const]])).creates).toEqual([{ name: "Amina Juma", ref: "R001" }]);
  });

  test("malformed, unsupported and oversized files are rejected before any preview", () => {
    expect(parseImportFile("fake.xlsx", new Uint8Array([1, 2, 3, 4]))).toEqual({ ok: false, reason: "malformed" });
    expect(parseImportFile("old.xls", new Uint8Array([1, 2, 3, 4]))).toEqual({ ok: false, reason: "unsupported_format" });
    expect(parseImportFile("big.csv", new Uint8Array(MAX_IMPORT_BYTES + 1))).toEqual({ ok: false, reason: "too_large" });
  });

  test("empty file parses to zero records; plan is empty, not an error", () => {
    const parsed = parseImportFile("e.csv", new TextEncoder().encode(""));
    if (!parsed.ok) throw new Error("parse");
    const preview = buildImportPreview({ rows: parsed.tables[0].rows, existing: [] });
    expect(preview.records).toHaveLength(0);
    expect(planImport(preview, new Map()).summary.committed).toBe(0);
  });

  test("non-English names and special characters survive the full import pipeline", () => {
    const csv = "Name,Adm\nZendaya Müüller-Smith, R/01\nالعربية طالب, A-9\n;";
    const parsed = parseImportFile("u.csv", new TextEncoder().encode(csv));
    if (!parsed.ok) throw new Error("parse");
    const preview = buildImportPreview({ rows: parsed.tables[0].rows, existing: [] });
    expect(preview.errorCount).toBe(0);
    const plan = planImport(preview, new Map());
    expect(plan.creates.map((c) => c.name)).toEqual(["Zendaya Müüller-Smith", "العربية طالب", ";"]);
  });

  test("full xlsx round-trip: exported register re-imports with zero duplicates", () => {
    // Export a register from real entries, then import it back.
    const dbWithRefs = [
      { id: "s1", classId: "c1", name: "Amina Juma", ref: "R001" },
      { id: "s2", classId: "c1", name: "Baraka Otieno", ref: "R002" },
    ];
    const entries = [
      { studentName: "Amina Juma", assessment: "Quiz 1", mark: 34, maxMark: 50, status: "confirmed" },
      { studentName: "Baraka Otieno", assessment: "Quiz 1", mark: 20, maxMark: 50, status: "confirmed" },
    ];
    const reg = buildRegister(entries, dbWithRefs.map((s) => ({ name: s.name, ref: s.ref })), {
      includeRef: true,
      includeTotal: false,
      includePercent: false,
    });
    const bytes = writeXlsx([{ name: "Register", rows: [reg.columns, ...reg.rows] }]);
    const parsed = parseImportFile("register.xlsx", bytes);
    if (!parsed.ok) throw new Error("exported register should parse");
    const preview = buildImportPreview({ rows: parsed.tables[0].rows, existing: dbWithRefs });
    // "34/50" style mark cells are not name/ref columns → auto-map picks Student+Ref.
    expect(preview.mapping).toEqual({ name: 0, ref: 1 });
    const plan = planImport(preview, new Map());
    expect(plan.creates).toHaveLength(0); // both match by ref — no duplicates
    expect(plan.summary.existingMatched).toBe(2);
  });
});
