/**
 * Marks-register builder — pure Stage 4 domain logic for spreadsheet export.
 *
 * Rules (from the product spec):
 *  - ONLY confirmed (teacher-approved) entries are exported. Pending and flagged
 *    entries are never exported; they are counted so the preview can say so.
 *  - The preview shows the EXACT output before any file is generated.
 *  - The builder never evaluates students: totals and percentages are raw
 *    arithmetic on teacher-awarded marks, nothing more.
 */

export type RegisterEntry = {
  studentName: string;
  assessment: string;
  mark: number;
  maxMark: number;
  status: string;
};

export type RegisterStudent = { name: string; ref?: string };

export type RegisterOptions = {
  /** Include a reference/register-number column when the roster has one. */
  includeRef: boolean;
  /** Include a raw total column (`sum/sumMax`). */
  includeTotal: boolean;
  /** Include a raw percentage column (teacher-awarded marks only). */
  includePercent: boolean;
};

export type RegisterPreview = {
  /** Exact output column headers — what the file will contain. */
  columns: string[];
  /** One row per student, in roster order (unknown students appended after). */
  rows: (string | number)[][];
  /** The optional max-marks row under the header ("" where not applicable). */
  maxRow: (string | number)[];
  /** Assessments in first-seen order among exported entries. */
  assessments: string[];
  /** Confirmed students not on the roster (exported, listed in the preview). */
  unmatched: string[];
  /** Entries excluded because they are pending/flagged — never silently dropped. */
  excludedCount: number;
  /** Assessment names with any excluded entries (surfaced in the preview). */
  excludedIn: string[];
};

const pct = (sum: number, max: number): number =>
  Math.round((sum / Math.max(1, max)) * 100);

/**
 * Build the register preview from real entries. `rosterOf` returns the class
 * roster (name + optional ref) so rows follow roster order and refs come from
 * the roster — entries themselves carry no register numbers.
 */
export function buildRegister(
  entries: RegisterEntry[],
  roster: RegisterStudent[],
  options: RegisterOptions,
): RegisterPreview {
  const confirmed = entries.filter((e) => e.status === "confirmed");
  const excluded = entries.length - confirmed.length;
  const excludedIn = [
    ...new Set(entries.filter((e) => e.status !== "confirmed").map((e) => e.assessment)),
  ];

  const assessments = [
    ...new Set(confirmed.map((e) => e.assessment)),
  ];

  const rosterByName = new Map(roster.map((s) => [s.name, s]));

  // Per-student aggregation keyed by name (the live entry shape keys on name).
  const byStudent = new Map<
    string,
    { marks: Map<string, { mark: number; max: number }>; sum: number; max: number }
  >();
  for (const e of confirmed) {
    const row = byStudent.get(e.studentName) ?? {
      marks: new Map<string, { mark: number; max: number }>(),
      sum: 0,
      max: 0,
    };
    row.marks.set(e.assessment, { mark: e.mark, max: e.maxMark });
    row.sum += e.mark;
    row.max += e.maxMark;
    byStudent.set(e.studentName, row);
  }

  const rosterOrder = roster.filter((s) => byStudent.has(s.name)).map((s) => s.name);
  const unmatched = [...byStudent.keys()].filter((n) => !rosterByName.has(n));
  const ordered = [...rosterOrder, ...unmatched];

  const columns: string[] = ["Student"];
  if (options.includeRef) columns.push("Ref");
  for (const a of assessments) columns.push(a);
  if (options.includeTotal) columns.push("Total");
  if (options.includePercent) columns.push("%");

  const maxRow: (string | number)[] = ["Max"];
  if (options.includeRef) maxRow.push("");
  const assessmentMax = new Map<string, number>();
  for (const a of assessments) {
    const m = confirmed.find((e) => e.assessment === a)?.maxMark ?? 0;
    assessmentMax.set(a, m);
  }
  for (const a of assessments) maxRow.push(assessmentMax.get(a) ?? "");
  if (options.includeTotal) maxRow.push([...assessmentMax.values()].reduce((x, y) => x + y, 0));
  if (options.includePercent) maxRow.push("");

  const rows = ordered.map((name) => {
    const s = byStudent.get(name)!;
    const row: (string | number)[] = [name];
    if (options.includeRef) row.push(rosterByName.get(name)?.ref ?? "");
    for (const a of assessments) {
      const m = s.marks.get(a);
      row.push(m ? `${m.mark}/${m.max}` : "");
    }
    if (options.includeTotal) row.push(`${s.sum}/${s.max}`);
    if (options.includePercent) row.push(pct(s.sum, s.max));
    return row;
  });

  return {
    columns,
    rows,
    maxRow,
    assessments,
    unmatched,
    excludedCount: excluded,
    excludedIn,
  };
}
