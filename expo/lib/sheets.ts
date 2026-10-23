import type { Entry } from "./store";

export type SheetStatus = "submitted" | "needsReview" | "inProgress";

export type SheetRow = {
  key: string;
  assessment: string;
  classId: string;
  entered: number;
  confirmed: number;
  total: number;
  updatedAt: string;
  status: SheetStatus;
};

/**
 * Derives mark-sheet rows from real signed entries by grouping per
 * class + assessment. Status rule: whole roster confirmed → submitted,
 * full roster entered but unconfirmed → needsReview, otherwise inProgress.
 * Newest first. Pure function — unit-tested in tests/sheets.test.ts.
 */
export function deriveSheets(entries: Entry[], rosterOf: (classId: string) => unknown[]): SheetRow[] {
  const groups = new Map<
    string,
    { assessment: string; classId: string; entered: number; confirmed: number; updatedAt: string }
  >();
  for (const e of entries) {
    const key = `${e.classId}::${e.assessment}`;
    const g =
      groups.get(key) ??
      { assessment: e.assessment, classId: e.classId, entered: 0, confirmed: 0, updatedAt: e.createdAt };
    g.entered += 1;
    if (e.status === "confirmed") g.confirmed += 1;
    if (new Date(e.createdAt).getTime() > new Date(g.updatedAt).getTime()) g.updatedAt = e.createdAt;
    groups.set(key, g);
  }
  return [...groups.entries()]
    .map(([key, g]) => {
      const total = rosterOf(g.classId).length || g.entered;
      const status: SheetStatus =
        g.confirmed >= total ? "submitted" : g.entered >= total ? "needsReview" : "inProgress";
      return { key, ...g, total, status };
    })
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}
