/**
 * RFC 4180 CSV reader/writer — pure domain logic, no dependencies.
 *
 * Parsing rules: comma-separated, double-quote escaping ("" inside quoted
 * fields), CRLF or LF line endings, quoted fields may contain commas and
 * newlines. The parser never evaluates cell contents (no formulas, no macros).
 * Writing mirrors the reader: fields with commas, quotes, or newlines are
 * quoted; formula-triggering leading characters are neutralized per the export
 * sanitization policy (see sanitizeCellText in xlsx-write).
 */

import { sanitizeCellText } from "@/src/files/xlsx-write";

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const push = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    push();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        field += ch;
        i += 1;
      }
      continue;
    }
    if (ch === '"' && field === "") {
      inQuotes = true;
      i += 1;
    } else if (ch === ",") {
      push();
      i += 1;
    } else if (ch === "\r") {
      endRow();
      i += text[i + 1] === "\n" ? 2 : 1;
    } else if (ch === "\n") {
      endRow();
      i += 1;
    } else {
      field += ch;
      i += 1;
    }
  }
  if (field !== "" || row.length > 0) endRow();
  // Drop trailing fully-empty rows (padding), keep interior empty rows as data.
  while (rows.length > 0 && rows[rows.length - 1].every((c) => c.trim() === "")) rows.pop();
  return rows;
}

const needsQuoting = (v: string) => /[",\r\n]/.test(v);

export function csvEscapeField(v: string | number): string {
  const s = String(v);
  return needsQuoting(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function writeCsv(header: string[], rows: (string | number)[][]): string {
  // Export sanitization: formula-triggering leading characters are neutralized
  // in text fields (numbers are never touched) — same policy as the xlsx writer.
  const cell = (v: string | number) =>
    typeof v === "number" ? csvEscapeField(v) : csvEscapeField(sanitizeCellText(v));
  const lines = [header.map(cell).join(",")];
  for (const r of rows) lines.push(r.map(cell).join(","));
  return lines.join("\r\n") + "\r\n";
}
