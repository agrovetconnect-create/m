/**
 * Real spreadsheet → roster detection. Given raw sheet rows it finds the
 * header, the name and ID (primary key) columns, rows missing required data,
 * and duplicates. Pure functions — unit-tested against real workbooks.
 */

import type { XlsxTable } from "@/lib/vendor/xlsx-lite";

export type RosterStudent = { name: string; ref?: string };

export type RosterAnalysis = {
  sheetName: string;
  headers: string[];
  headerRow: number;
  rowsTotal: number;
  nameCol: number;
  idCol: number | null;
  students: RosterStudent[];
  missingName: number;
  duplicates: number;
};

const NAME_HEADER = /(full\s*)?name|student|pupil|nom(\s|$)|nome|jina|الاسم|名称/i;
const ID_HEADER = /(student[\s_-]*)?(id|reg(istration)?|adm(ission)?|roll|matric|matricul[a-z]*|serial|index)|number|no\.?$|namba|رقم|编号/i;

function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff\u4e00-\u9fff]+/g, " ")
    .trim();
}

function digitsRatio(values: string[]): number {
  const vals = values.filter(Boolean);
  if (vals.length === 0) return 0;
  let digits = 0;
  let total = 0;
  for (const v of vals) {
    for (const ch of v) {
      total += 1;
      if (/[0-9]/.test(ch)) digits += 1;
    }
  }
  return total === 0 ? 0 : digits / total;
}

function uniqueness(values: string[]): number {
  const vals = values.filter(Boolean);
  if (vals.length === 0) return 0;
  return new Set(vals.map(norm)).size / vals.length;
}

const HEADER_LIKE = /(full\s*)?name|student|pupil|nom\b|nome|jina|id\b|reg|adm|roll|matric|number|namba|class|grade|stream|الاسم|编号/i;

/** Pick the first row with ≥2 filled cells as the header; a single descriptive cell also counts. */
function findHeader(rows: string[][]): { headerRow: number; headers: string[] } {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const filled = rows[i].filter((c) => c.trim().length > 0);
    if (filled.length >= 2) return { headerRow: i, headers: rows[i].map((c) => c.trim()) };
    if (filled.length === 1 && HEADER_LIKE.test(filled[0])) {
      return { headerRow: i, headers: rows[i].map((c) => c.trim()) };
    }
  }
  return { headerRow: -1, headers: [] };
}

/**
 * Detect name/ID columns and build the roster. Prefers header-text matching;
 * falls back to cell-shape signals (letters vs digits, uniqueness) when the
 * sheet has no descriptive header.
 */
export function analyzeRoster(sheet: XlsxTable): RosterAnalysis {
  const rows = sheet.rows;
  const { headerRow, headers } = findHeader(rows);
  const dataRows = headerRow >= 0 ? rows.slice(headerRow + 1) : rows;
  const cols = Math.max(headers.length, ...dataRows.map((r) => r.length), 0);
  const column = (i: number): string[] => dataRows.map((r) => (r[i] ?? "").trim());

  let nameCol = 0;
  let idCol: number | null = null;

  for (let i = 0; i < cols; i++) {
    const h = headers[i] ?? "";
    if (NAME_HEADER.test(h) && !ID_HEADER.test(h)) {
      nameCol = i;
      break;
    }
  }
  for (let i = 0; i < cols; i++) {
    const h = headers[i] ?? "";
    if (ID_HEADER.test(h) && !NAME_HEADER.test(h)) {
      idCol = i;
      break;
    }
  }
  if (!NAME_HEADER.test(headers[nameCol] ?? "")) {
    // Shape fallback: the column with the most letter-heavy, unique values.
    let best = -1;
    let bestScore = -1;
    for (let i = 0; i < cols; i++) {
      const vals = column(i);
      if (vals.filter(Boolean).length === 0) continue;
      const letters = 1 - digitsRatio(vals);
      const score = letters * 0.6 + uniqueness(vals) * 0.4;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best >= 0) nameCol = best;
  }
  if (idCol === null) {
    // Primary-key fallback: unique, digit-heavy, not the name column.
    let best = -1;
    let bestScore = 0;
    for (let i = 0; i < cols; i++) {
      if (i === nameCol) continue;
      const vals = column(i);
      if (vals.filter(Boolean).length === 0) continue;
      const score = uniqueness(vals) * 0.5 + digitsRatio(vals) * 0.5;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best >= 0 && bestScore > 0.55) idCol = best;
  }

  const students: RosterStudent[] = [];
  let missingName = 0;
  for (const r of dataRows) {
    const name = (r[nameCol] ?? "").trim();
    if (!name) {
      // A row that is entirely empty is padding, not a missing name.
      if (r.some((c) => c.trim().length > 0)) missingName += 1;
      continue;
    }
    const ref = idCol !== null ? (r[idCol] ?? "").trim() || undefined : undefined;
    students.push({ name, ref });
  }

  const seen = new Set<string>();
  let duplicates = 0;
  for (const s of students) {
    const key = s.ref ? `#${norm(s.ref)}` : norm(s.name);
    if (seen.has(key)) duplicates += 1;
    else seen.add(key);
  }

  return {
    sheetName: sheet.name,
    headers,
    headerRow,
    rowsTotal: dataRows.length,
    nameCol,
    idCol,
    students,
    missingName,
    duplicates,
  };
}

/** Re-map columns after the teacher re-assigns the name/ID roles. */
export function rebuildRoster(sheet: XlsxTable, analysis: RosterAnalysis, nameCol: number, idCol: number | null): RosterAnalysis {
  const dataRows = analysis.headerRow >= 0 ? sheet.rows.slice(analysis.headerRow + 1) : sheet.rows;
  const students: RosterStudent[] = [];
  let missingName = 0;
  for (const r of dataRows) {
    const name = (r[nameCol] ?? "").trim();
    if (!name) {
      if (r.some((c) => c.trim().length > 0)) missingName += 1;
      continue;
    }
    const ref = idCol !== null ? (r[idCol] ?? "").trim() || undefined : undefined;
    students.push({ name, ref });
  }
  const seen = new Set<string>();
  let duplicates = 0;
  for (const s of students) {
    const key = s.ref ? `#${norm(s.ref)}` : norm(s.name);
    if (seen.has(key)) duplicates += 1;
    else seen.add(key);
  }
  return { ...analysis, nameCol, idCol, students, missingName, duplicates };
}
