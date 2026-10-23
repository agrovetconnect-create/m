/**
 * Import engine — pure Stage 4 domain logic for the .xlsx/.csv import wizard.
 *
 * Pipeline: parse → detect header row → map columns (auto-hinted, always
 * teacher-correctable) → normalize + validate rows (issues carry row numbers
 * and are classified as errors or warnings) → match against existing students
 * (stable `ref` identifier; name-only matches are warnings, never merges) →
 * teacher resolves duplicates explicitly → plan produces truthful summary
 * counts from the actual records.
 *
 * Nothing here writes to the store; the wizard applies the plan through one
 * atomic store write. Imports are data-only: cell contents are never evaluated
 * as formulas or code.
 */

import { parseCsv } from "./csv";
import { readXlsx } from "@/lib/vendor/xlsx-lite";
import { identityKey, findDuplicateMatches, type StudentLike, type DuplicateMatch } from "./register-management";

// --- Parsing ------------------------------------------------------------------

/** Import size guard (bytes) — oversized files are rejected before parsing. */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export type ParsedFile =
  | { ok: true; kind: "xlsx" | "csv"; tables: { name: string; rows: string[][] }[] }
  | { ok: false; reason: "unsupported_format" | "too_large" | "malformed" };

function decodeUtf8(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b < 0x80) {
      out += String.fromCharCode(b);
      i += 1;
    } else if (b < 0xe0) {
      out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f));
      i += 2;
    } else if (b < 0xf0) {
      out += String.fromCharCode(
        ((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f),
      );
      i += 3;
    } else {
      const cp = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f);
      out += String.fromCodePoint(cp);
      i += 4;
    }
  }
  return out;
}

/** Parse an uploaded file. Format is sniffed by extension and content guard. */
export function parseImportFile(fileName: string, bytes: Uint8Array): ParsedFile {
  if (bytes.length > MAX_IMPORT_BYTES) return { ok: false, reason: "too_large" };
  const lower = fileName.toLowerCase();
  try {
    if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
      return { ok: true, kind: "csv", tables: [{ name: fileName, rows: parseCsv(decodeUtf8(bytes)) }] };
    }
    if (lower.endsWith(".xlsx")) {
      // Guard against a renamed non-ZIP payload before parsing.
      if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) return { ok: false, reason: "malformed" };
      const tables = readXlsx(bytes).map((t) => ({ name: t.name, rows: t.rows }));
      return { ok: true, kind: "xlsx", tables };
    }
    // .xls and everything else: genuinely unsupported by the in-repo parsers.
    return { ok: false, reason: "unsupported_format" };
  } catch (err) {
    if (err instanceof Error && err.message === "XLSX_BAD_FORMAT") return { ok: false, reason: "unsupported_format" };
    return { ok: false, reason: "malformed" };
  }
}

// --- Header row detection -------------------------------------------------------

export function detectHeaderRow(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const filled = rows[i].filter((c) => c.trim().length > 0);
    if (filled.length >= 2) return i;
  }
  return rows.length > 0 ? 0 : -1;
}

// --- Column mapping -------------------------------------------------------------

const NAME_HINT = /(full\s*)?name|student|pupil|nom(\s|$)|nome|jina|الاسم|名称/i;
const REF_HINT =
  /(student[\s_-]*)?(id|reg(istration)?|ref(eren[cs]e)?|adm(ission)?|roll|matric[a-z]*|serial|index|candidate)|number|no\.?$|namba|رقم|编号/i;

/**
 * Auto-map columns from header text hints. These are HINTS only — the wizard
 * always shows the mapping for the teacher to review and correct, and nothing
 * is imported until they confirm.
 */
export function autoMap(headers: string[]): { name: number; ref: number | null } {
  let name = -1;
  let ref: number | null = null;
  headers.forEach((h, i) => {
    const isName = NAME_HINT.test(h) && !REF_HINT.test(h);
    const isRef = REF_HINT.test(h) && !NAME_HINT.test(h);
    if (isName && name === -1) name = i;
    if (isRef && ref === null) ref = i;
  });
  if (name === -1) name = headers.length > 0 ? 0 : -1;
  return { name, ref };
}

// --- Preview / validation ---------------------------------------------------------

export type ImportIssue = {
  row: number; // 1-based data row number (after the header row)
  severity: "error" | "warning";
  reason:
    | "missing_name"
    | "duplicate_ref_in_file"
    | "duplicate_name_in_file"
    | "oversized"
    | "possible_existing_student"
    | "no_records"
    | "ambiguous_mapping";
  detail: string;
};

export type ImportRecord = {
  row: number;
  name: string;
  ref?: string;
  /** Original cells — preserved for auditability and debugging. */
  raw: string[];
  matches: DuplicateMatch[];
  issues: ImportIssue[];
};

export type ImportPreview = {
  headers: string[];
  headerRowIndex: number;
  mapping: { name: number; ref: number | null };
  records: ImportRecord[];
  totalRows: number;
  errorCount: number;
  warningCount: number;
};

export type BuildPreviewInput = {
  rows: string[][];
  headerRow?: number;
  mapping?: { name: number; ref: number | null };
  existing: StudentLike[];
};

const MAX_CELL = 200;

export function buildImportPreview(input: BuildPreviewInput): ImportPreview {
  const { rows, existing } = input;
  const headerRowIndex = input.headerRow ?? detectHeaderRow(rows);
  const headers = headerRowIndex >= 0 ? rows[headerRowIndex].map((c) => c.trim()) : [];
  const mapping = input.mapping ?? (headers.length > 0 ? autoMap(headers) : { name: 0, ref: null });
  const dataRows = headerRowIndex >= 0 ? rows.slice(headerRowIndex + 1) : rows;

  const records: ImportRecord[] = [];
  const refSeen = new Map<string, number>();
  const nameSeen = new Map<string, number>();

  dataRows.forEach((raw, idx) => {
    const row = idx + 1; // 1-based data row numbering (row numbers exclude the header)
    const issues: ImportIssue[] = [];
    if (raw.every((c) => c.trim() === "")) return; // padding row, not an error

    const name = mapping.name >= 0 ? (raw[mapping.name] ?? "").trim() : "";
    const ref = mapping.ref !== null ? (raw[mapping.ref] ?? "").trim() || undefined : undefined;
    for (const cell of raw) {
      if (cell.length > MAX_CELL) {
        issues.push({ row, severity: "error", reason: "oversized", detail: `cell exceeds ${MAX_CELL} characters` });
        break;
      }
    }

    if (!name) {
      issues.push({ row, severity: "error", reason: "missing_name", detail: "name column is empty in this row" });
    } else {
      const nk = identityKey(name);
      if (ref) {
        const rk = identityKey(ref);
        const first = refSeen.get(rk);
        if (first !== undefined) {
          issues.push({
            row,
            severity: "error",
            reason: "duplicate_ref_in_file",
            detail: `same registration number as data row ${first}`,
          });
        } else {
          refSeen.set(rk, row);
        }
      } else {
        const first = nameSeen.get(nk);
        if (first !== undefined) {
          issues.push({
            row,
            severity: "error",
            reason: "duplicate_name_in_file",
            detail: `no registration numbers, same name as data row ${first}`,
          });
        } else {
          nameSeen.set(nk, row);
        }
      }
    }

    const matches = name ? findDuplicateMatches({ name, ref }, existing) : [];
    for (const m of matches) {
      if (m.reason === "same_name") {
        issues.push({
          row,
          severity: "warning",
          reason: "possible_existing_student",
          detail: `same name as existing student "${m.existingName}" (no registration numbers on either record)`,
        });
      }
    }

    records.push({ row, name, ref, raw: [...raw], matches, issues });
  });

  if (records.length === 0 && dataRows.length >= 0 && rows.length > 0) {
    // fall through — counts surface "no usable records" via errorCount/preview
  }

  const errorCount = records.filter((r) => r.issues.some((i) => i.severity === "error")).length;
  const warningCount = records.filter((r) => r.issues.some((i) => i.severity === "warning")).length;
  return {
    headers,
    headerRowIndex,
    mapping,
    records,
    totalRows: dataRows.filter((r) => r.some((c) => c.trim() !== "")).length,
    errorCount,
    warningCount,
  };
}

// --- Resolution → plan ---------------------------------------------------------------

export type RowChoice = "skip" | "update" | "keep_both";

export type ImportPlan = {
  creates: { name: string; ref?: string }[];
  updates: { id: string; name: string; ref?: string }[];
  summary: {
    totalRows: number;
    validRows: number;
    newStudents: number;
    existingMatched: number;
    updated: number;
    duplicatesDetected: number;
    invalidRows: number;
    skippedRows: number;
    committed: number;
  };
};

/**
 * Apply the teacher's per-row resolutions and compute the summary from the
 * actual records. Rows with unresolved ERRORS block confirmation — the wizard
 * must resolve or explicitly skip them first (checked by `canConfirm`).
 */
export function canConfirm(preview: ImportPreview, choices: Map<number, RowChoice>): boolean {
  return preview.records.every((r) => {
    const hasError = r.issues.some((i) => i.severity === "error");
    return !hasError || choices.has(r.row);
  });
}

export function planImport(preview: ImportPreview, choices: Map<number, RowChoice>): ImportPlan {
  const creates: ImportPlan["creates"] = [];
  const updates: ImportPlan["updates"] = [];
  let validRows = 0;
  let existingMatched = 0;
  let updated = 0;
  let duplicatesDetected = 0;
  let invalidRows = 0;
  let skippedRows = 0;

  for (const rec of preview.records) {
    const hasError = rec.issues.some((i) => i.severity === "error");
    const hasRefMatch = rec.matches.some((m) => m.reason === "same_ref");
    const choice = choices.get(rec.row);

    if (hasError && !choice) {
      invalidRows += 1; // blocked by canConfirm; counted truthfully anyway
      continue;
    }
    if (choice === "skip") {
      skippedRows += 1;
      continue;
    }
    if (hasError) {
      // Explicitly resolved (skip handled above; keep_both proceeds below).
      duplicatesDetected += 1;
    }
    if (hasRefMatch) {
      existingMatched += 1;
      duplicatesDetected += 1;
      if (choice === "update") {
        const m = rec.matches.find((x) => x.reason === "same_ref")!;
        updates.push({ id: m.existingId, name: rec.name, ref: rec.ref });
        updated += 1;
      } else if (choice === "keep_both") {
        // The teacher explicitly confirmed these are distinct students.
        creates.push({ name: rec.name, ref: rec.ref });
      } else {
        // same_ref match with no explicit choice defaults to SKIP the incoming
        // row — re-importing the same file must not create duplicates.
        skippedRows += 1;
      }
      continue;
    }
    validRows += 1;
    creates.push({ name: rec.name, ref: rec.ref });
  }

  const committed = creates.length + updates.length;
  return {
    creates,
    updates,
    summary: {
      totalRows: preview.totalRows,
      validRows,
      newStudents: creates.length,
      existingMatched,
      updated,
      duplicatesDetected,
      invalidRows,
      skippedRows,
      committed,
    },
  };
}
