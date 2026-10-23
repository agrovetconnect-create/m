import { describe, expect, test } from "bun:test";
import { validateMark, duplicateKey, isDuplicate } from "../src/domain/marks";
import {
  initialScanState,
  scanStateMachine,
  canCapture,
  cameraInUse,
  type ScanningEvent,
} from "../src/scanning/engine";
import {
  MemoryStorageAdapter,
  runMigrations,
  safelyParse,
  SCHEMA_VERSION_KEY,
  type Migration,
} from "../src/storage/adapter";
import { assertSafeExportTarget, sniffFormat, uniqueName, type ImportedFile } from "../src/files/adapter";
import { readClientConfig } from "../src/config/env";

/**
 * Stage 3 foundation tests: domain rules, scanning state machine, storage
 * migrations/recovery, file-boundary rules, and configuration validation —
 * all pure logic, no hardware and no RN runtime required.
 */

describe("domain: mark validation", () => {
  test("accepts valid marks (number or string) up to the maximum", () => {
    expect(validateMark(34, 50)).toEqual({ ok: true, value: 34 });
    expect(validateMark(" 34 ", 50)).toEqual({ ok: true, value: 34 });
    expect(validateMark("12,5", 50)).toEqual({ ok: true, value: 12.5 });
    expect(validateMark(0, 50)).toEqual({ ok: true, value: 0 });
    expect(validateMark(50, 50)).toEqual({ ok: true, value: 50 });
  });

  test("rejects the boundary violations with explicit reasons", () => {
    expect(validateMark(51, 50).ok).toBe(false);
    expect(validateMark(-1, 50)).toMatchObject({ ok: false, reason: "negative" });
    expect(validateMark("abc", 50)).toMatchObject({ ok: false, reason: "notNumeric" });
    expect(validateMark("", 50)).toMatchObject({ ok: false, reason: "empty" });
    expect(validateMark(1.234, 50)).toMatchObject({ ok: false, reason: "tooManyDecimals" });
    expect(validateMark(10, 0)).toMatchObject({ ok: false, reason: "notFinite" });
  });

  test("a rejected mark is never a number (no silent coercion)", () => {
    const r = validateMark("3o", 50);
    expect(r.ok).toBe(false);
  });

  test("duplicate (student, assessment) keys are detected exactly", () => {
    const seen = [duplicateKey("s1", "a1")];
    expect(isDuplicate("s1", "a1", seen)).toBe(true);
    expect(isDuplicate("s1", "a2", seen)).toBe(false);
    expect(isDuplicate("s2", "a1", seen)).toBe(false);
  });
});

describe("scanning state machine", () => {
  const drive = (events: ScanningEvent[]) => events.reduce(scanStateMachine, initialScanState);

  test("idle → ready → paperReady is capturable; idle is not", () => {
    const idle = drive([{ type: "camera", phase: "ready" }]);
    expect(canCapture(idle)).toBe(false);
    const ready = drive([
      { type: "camera", phase: "ready" },
      { type: "activity", activity: "paperReady" },
    ]);
    expect(canCapture(ready)).toBe(true);
  });

  test("camera never auto-starts: initial state is idle/inactive", () => {
    expect(initialScanState.camera).toBe("idle");
    expect(initialScanState.activity).toBe("inactive");
  });

  test("duplicate suppression is an explicit alert, not a silent drop", () => {
    const s = drive([
      { type: "camera", phase: "ready" },
      { type: "activity", activity: "paperReady" },
      { type: "alert", kind: "duplicateSuppressed" },
    ]);
    expect(s.alert?.kind).toBe("duplicateSuppressed");
  });

  test("quality and multi-paper alerts surface with details", () => {
    const s = drive([
      { type: "camera", phase: "ready" },
      { type: "alert", kind: "qualityInsufficient", detail: "blurry" },
    ]);
    expect(s.alert).toEqual({ kind: "qualityInsufficient", detail: "blurry" });
  });

  test("disconnection pauses activity but preserves the processed count; stop releases resources", () => {
    const mid = drive([
      { type: "camera", phase: "ready" },
      { type: "activity", activity: "processing" },
      { type: "camera", phase: "disconnected" },
    ]);
    expect(mid.camera).toBe("disconnected");
    expect(mid.activity).toBe("paused");
    expect(cameraInUse(mid)).toBe(false);
    expect(mid.processedCount).toBe(0);
    const stopped = scanStateMachine({ ...mid, processedCount: 3 }, { type: "stop" });
    expect(stopped).toEqual(initialScanState);
    expect(cameraInUse(stopped)).toBe(false);
  });

  test("unavailable and permission-denied are distinct honest states", () => {
    expect(drive([{ type: "camera", phase: "unavailable" }]).camera).toBe("unavailable");
    expect(drive([{ type: "camera", phase: "permissionDenied" }]).camera).toBe("permissionDenied");
  });
});

describe("storage migrations", () => {
  test("applies pending migrations in order and records the version", async () => {
    const adapter = new MemoryStorageAdapter();
    const migrations: Migration[] = [
      { toVersion: 1, description: "create base keys", run: async (a) => void (await a.setItem("k1", "v1")) },
      { toVersion: 2, description: "rename k1", run: async (a) => {
        const v = await a.getItem("k1");
        if (v !== null) { await a.setItem("k2", v); await a.removeItem("k1"); }
      } },
    ];
    const r = await runMigrations(adapter, migrations);
    expect(r).toEqual({ ok: true, fromVersion: 0, toVersion: 2, applied: 2 });
    expect(await adapter.getItem("k2")).toBe("v1");
    expect(await adapter.getItem("k1")).toBe(null);
    expect(await adapter.getItem(SCHEMA_VERSION_KEY)).toBe("2");
  });

  test("a failed migration leaves the store at the previous version (retryable)", async () => {
    const adapter = new MemoryStorageAdapter();
    await adapter.setItem(SCHEMA_VERSION_KEY, "1");
    const boom: Migration = { toVersion: 2, description: "explode", run: async () => { throw new Error("disk full"); } };
    const after: Migration = { toVersion: 3, description: "never runs", run: async () => void (await adapter.setItem("tainted", "1")) };
    const r = await runMigrations(adapter, [boom, after]);
    expect(r).toMatchObject({ ok: false, failedAtVersion: 1, error: "disk full" });
    expect(await adapter.getItem(SCHEMA_VERSION_KEY)).toBe("1");
    expect(await adapter.getItem("tainted")).toBe(null);
  });

  test("migration gaps are refused, not skipped", async () => {
    const adapter = new MemoryStorageAdapter();
    const r = await runMigrations(adapter, [
      { toVersion: 3, description: "gap", run: async () => {} },
    ]);
    expect(r.ok).toBe(false);
  });

  test("corrupt version marker fails safely instead of running migrations", async () => {
    const adapter = new MemoryStorageAdapter();
    await adapter.setItem(SCHEMA_VERSION_KEY, "banana");
    const r = await runMigrations(adapter, [
      { toVersion: 1, description: "x", run: async () => {} },
    ]);
    expect(r.ok).toBe(false);
  });
});

describe("storage recovery", () => {
  test("safelyParse falls back and quarantines corrupt payloads", async () => {
    const adapter = new MemoryStorageAdapter();
    await adapter.setItem("data", "{not json");
    const out = await safelyParse(adapter, "data", (raw) => {
      try { return JSON.parse(raw) as { n: number }; } catch { return null; }
    }, { n: 0 });
    expect(out).toEqual({ n: 0 });
    expect(await adapter.getItem("data.corrupt")).toBe("{not json");
  });

  test("safelyParse returns the parsed value for healthy data (no quarantine)", async () => {
    const adapter = new MemoryStorageAdapter();
    await adapter.setItem("good", JSON.stringify({ n: 7 }));
    const out = await safelyParse<{ n: number }>(adapter, "good", JSON.parse, { n: 0 });
    expect(out).toEqual({ n: 7 });
    expect(await adapter.getItem("good.corrupt")).toBe(null);
  });
});

describe("file boundary", () => {
  const src: ImportedFile = { name: "Term 2 Register.xlsx", format: "xlsx", sizeBytes: 10, ref: "src" };

  test("sniffs supported formats and rejects others with reasons", () => {
    expect(sniffFormat("a.xlsx")).toEqual({ ok: true, format: "xlsx" });
    expect(sniffFormat("a.CSV")).toEqual({ ok: true, format: "csv" });
    expect(sniffFormat("a.xls").ok).toBe(false);
    expect(sniffFormat("a.pdf").ok).toBe(false);
    expect(sniffFormat("noext").ok).toBe(false);
  });

  test("exports never overwrite the imported register", () => {
    expect(assertSafeExportTarget(src, "Term 2 Register.xlsx")).toMatchObject({ ok: false });
    expect(assertSafeExportTarget(src, "Term 2 Register (marked).xlsx")).toEqual({ ok: true });
    expect(assertSafeExportTarget(null, "New Register.xlsx")).toEqual({ ok: true });
    expect(assertSafeExportTarget(null, "  ")).toMatchObject({ ok: false });
  });

  test("duplicate export names get unique suffixed names", () => {
    const taken = (n: string) => n === "Out.xlsx" || n === "Out (2).xlsx";
    expect(uniqueName("Out.xlsx", taken)).toBe("Out (3).xlsx");
    expect(uniqueName("Fresh.xlsx", taken)).toBe("Fresh.xlsx");
  });
});

describe("configuration validation", () => {
  test("absent optional services → offline-first mode, not an error", () => {
    const r = readClientConfig({});
    expect(r).toMatchObject({ ok: true, config: { mode: "offline-first", cloudSync: null } });
  });

  test("complete cloud config selects full mode", () => {
    const r = readClientConfig({
      EXPO_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      EXPO_PUBLIC_SUPABASE_ANON_KEY: "anon",
    });
    expect(r).toMatchObject({ ok: true, config: { mode: "full" } });
  });

  test("contradictory config is a hard error naming the offending key", () => {
    const r = readClientConfig({ EXPO_PUBLIC_SUPABASE_URL: "https://x.y" });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.issues[0].key).toBe("EXPO_PUBLIC_SUPABASE_ANON_KEY");
  });

  test("malformed URLs are rejected", () => {
    const r = readClientConfig({
      EXPO_PUBLIC_SUPABASE_URL: "not a url",
      EXPO_PUBLIC_SUPABASE_ANON_KEY: "anon",
    });
    expect(r).toMatchObject({ ok: false });
  });
});
