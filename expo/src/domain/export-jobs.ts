/**
 * Export-job lifecycle — pure Stage 4 rules on the Stage 3 file boundary.
 * The register a teacher imported (or any source) is NEVER overwritten: the
 * destination must be a new file, the job is `completed` only after the file
 * actually exists, and entries are marked `exported` only after that.
 */

import type { ExportJob } from "./models";
import { assertSafeExportTarget, uniqueName } from "@/src/files/adapter";
import type { ImportedFile } from "@/src/files/adapter";

export type ExportRequest = {
  format: "xlsx" | "csv";
  /** What the teacher asked to call the file. */
  desiredName: string;
  /** The imported source register, when the session had one. */
  source: ImportedFile | null;
  /** Names already taken in the destination (existing files). */
  takenNames: (candidate: string) => boolean;
  now: () => string;
};

export type ExportPlan =
  | { ok: true; job: ExportJob }
  | { ok: false; reason: string };

/**
 * Plan an export: resolve a safe, unique destination name and return the job in
 * `pending`. Fails closed — never returns a plan that could overwrite anything.
 */
export function planExport(id: string, req: ExportRequest): ExportPlan {
  const safe = assertSafeExportTarget(req.source, req.desiredName);
  if (!safe.ok) return { ok: false, reason: safe.reason };
  const outputRef = uniqueName(req.desiredName, req.takenNames);
  return {
    ok: true,
    job: {
      id,
      sourceRef: req.source?.name ?? "(live records)",
      outputRef,
      format: req.format,
      createdAt: req.now(),
      status: "pending",
    },
  };
}

/**
 * Complete a job — call ONLY after the file exists at `outputRef`.
 */
export function completeExport(job: ExportJob): ExportJob {
  return { ...job, status: "completed" };
}

export function failExport(job: ExportJob, reason: string): ExportJob & { failReason: string } {
  return { ...job, status: "failed", failReason: reason };
}

export type ExportableEntry = { id: string; status: string };

/**
 * Which confirmed entries this job covers. Entries in any other state are
 * never exported — the caller gets them listed as excluded.
 */
export function exportableEntries<T extends ExportableEntry>(entries: T[]): {
  included: T[];
  excluded: T[];
} {
  const included = entries.filter((e) => e.status === "confirmed");
  return { included, excluded: entries.filter((e) => e.status !== "confirmed") };
}

/**
 * Mark the exported entries with the `exported` status — after completion, on
 * the returned copies only (callers replace them in their store).
 */
export function markExported<T extends ExportableEntry & { status: string }>(
  entries: T[],
): T[] {
  return entries.map((e) => ({ ...e, status: "exported" }));
}
