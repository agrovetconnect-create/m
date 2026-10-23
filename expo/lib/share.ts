import { Platform, Share } from "react-native";
import { StorageAccessFramework } from "expo-file-system/legacy";
import { writeXlsx, bytesToBase64 } from "@/src/files/xlsx-write";
import { writeCsv } from "@/src/domain/csv";
import type { XlsxSheet } from "@/src/files/xlsx-write";

/**
 * Shared CSV export: escapes every cell (quotes, commas, newlines) and opens
 * the share sheet. Kept as the web fallback and the "Share" convenience path;
 * the real file saves go through saveXlsx / saveCsvFile below.
 */
export async function shareCsv(header: string, rows: (string | number)[][]): Promise<void> {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""').replace(/\n/g, " ")}"`;
  const body = rows.map((r) => r.map(esc).join(",")).join("\n");
  await Share.share({ message: `${header}\n${body}` });
}

export type FileSaveResult =
  | { ok: true; fileName: string }
  | { ok: false; reason: "no_directory" | "write_failed" };

async function saveFile(baseName: string, mime: string, ext: string, data: Uint8Array): Promise<FileSaveResult> {
  if (Platform.OS === "web") return { ok: false, reason: "no_directory" };
  try {
    const perms = await StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (!perms.granted) return { ok: false, reason: "no_directory" };
    const safeName = baseName.replace(/[:\\/?*[\]]/g, " ").replace(new RegExp(`\\.${ext}$`, "i"), "").trim() || "export";
    const fileName = `${safeName}.${ext}`;
    const fileUri = await StorageAccessFramework.createFileAsync(perms.directoryUri, fileName, mime);
    await StorageAccessFramework.writeAsStringAsync(fileUri, bytesToBase64(data), { encoding: "base64" });
    return { ok: true, fileName };
  } catch {
    return { ok: false, reason: "write_failed" };
  }
}

/**
 * Real .xlsx export: builds a genuine Excel workbook with the dependency-free
 * writer and saves it through the system document framework (Android SAF), so
 * the teacher picks the folder and the file is a real file — never a text
 * message pretending to be one. Web has no SAF, so callers fall back to the
 * CSV share there (clearly labeled as CSV in the UI).
 */
export async function saveXlsx(sheets: XlsxSheet[], baseName: string): Promise<FileSaveResult> {
  return saveFile(baseName, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx", writeXlsx(sheets));
}

/**
 * Real .csv file export with the same sanitization policy as the xlsx writer
 * (formula-triggering leading characters neutralized, numbers untouched).
 */
export async function saveCsvFile(header: string[], rows: (string | number)[][], baseName: string): Promise<FileSaveResult> {
  return saveFile(baseName, "text/csv", "csv", new TextEncoder().encode(writeCsv(header, rows)));
}
