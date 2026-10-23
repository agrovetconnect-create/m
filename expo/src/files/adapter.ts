/**
 * Stage 3 file-handling boundary — platform-compatible abstractions for the
 * future spreadsheet service (Excel import/export, Stage 4+).
 *
 * Rules enforced here, independent of any UI:
 *  - **The source register is never overwritten by default** — every export
 *    must target a path distinct from the import's, checked up front.
 *  - Unsupported formats are rejected with a reason, not guessed at.
 *  - Cancelled selections are a normal, expected outcome (typed, not an error).
 */

export type FileFormat = "xlsx" | "csv";

export type ImportedFile = {
  name: string;
  format: FileFormat;
  sizeBytes: number;
  /** Adapter-specific handle/URI; the domain never inspects it directly. */
  ref: string;
};

export type FilePickResult =
  | { kind: "picked"; file: ImportedFile }
  | { kind: "cancelled" }
  | { kind: "unsupported"; name: string; reason: string };

/**
 * Platform adapter contract: web uses a file input / File System Access API,
 * native uses the system document picker, desktop gets the Tauri dialog at
 * packaging time. The app depends on this interface only.
 */
export interface FileAdapter {
  /** Ask the teacher for an importable register file. */
  pickImport(): Promise<FilePickResult>;
  /** Read a picked file as text (CSV / small XLSX wrappers). */
  readText(file: ImportedFile): Promise<string>;
  /** Write an export copy; MUST fail rather than overwrite existing files. */
  writeExportCopy(name: string, content: string): Promise<{ ref: string }>;
}

const SUPPORTED: FileFormat[] = ["xlsx", "csv"];

/** Format sniff from the filename — honest rejection for anything else. */
export function sniffFormat(name: string): { ok: true; format: FileFormat } | { ok: false; reason: string } {
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
  if ((SUPPORTED as string[]).includes(ext)) return { ok: true, format: ext as FileFormat };
  return {
    ok: false,
    reason: ext === "xls" ? "Legacy .xls is not supported — save as .xlsx or .csv" : `Unsupported file type .${ext || "?"} — use .xlsx or .csv`,
  };
}

/**
 * Ensure an export destination is a NEW file: never the imported source, and
 * never an existing output (duplicate filenames get a numeric suffix, which
 * the caller retries until `unique` accepts — see uniqueName below).
 */
export function assertSafeExportTarget(source: ImportedFile | null, outputName: string): { ok: true } | { ok: false; reason: string } {
  if (!outputName || outputName.trim() === "") return { ok: false, reason: "Export needs a file name" };
  if (source && outputName === source.name) {
    return { ok: false, reason: "Exports never overwrite the imported register — choose a new name" };
  }
  return { ok: true };
}

/** Produce `base (2).ext`-style names for duplicate outputs. */
export function uniqueName(name: string, taken: (candidate: string) => boolean): string {
  if (!taken(name)) return name;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let i = 2; i < 1000; i++) {
    const candidate = `${stem} (${i})${ext}`;
    if (!taken(candidate)) return candidate;
  }
  return `${stem} (${Date.now()})${ext}`;
}
