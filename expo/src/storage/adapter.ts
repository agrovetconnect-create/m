/**
 * Stage 3 storage foundation — the versioned persistence seam.
 *
 * The live app keeps using the approved AES-256-encrypted AsyncStorage layer
 * (`lib/store.tsx` + `lib/crypto.ts`); this module defines the *interface* and
 * the migration runner so a future SQLite adapter (dev build) can replace the
 * engine without touching call sites, and so schema evolution is versioned and
 * tested instead of ad-hoc key renames.
 *
 * Honest encryption note: this module makes no encryption claims — whatever
 * the injected adapter does (or doesn't) is the adapter's documented behavior.
 */

/** Minimal async KV contract every platform adapter must implement. */
export interface StorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** In-memory adapter for tests and previews — never used in the shipped app. */
export class MemoryStorageAdapter implements StorageAdapter {
  private map = new Map<string, string>();
  getItem = async (key: string) => this.map.get(key) ?? null;
  setItem = async (key: string, value: string) => void this.map.set(key, value);
  removeItem = async (key: string) => void this.map.delete(key);
}

export const SCHEMA_VERSION_KEY = "marks.schema.version";

/** A migration upgrades persisted data one schema version. Must be idempotent-safe: run at most once by the runner. */
export type Migration = {
  toVersion: number;
  description: string;
  run: (adapter: StorageAdapter) => Promise<void>;
};

export type MigrationResult =
  | { ok: true; fromVersion: number; toVersion: number; applied: number }
  | { ok: false; fromVersion: number; failedAtVersion: number; error: string };

/**
 * Run pending migrations in order. The version key is written only after a
 * migration's `run` resolves, so a failed migration leaves the store at its
 * previous version (retryable) rather than half-migrated. Callers should wrap
 * multi-key migrations with their own backup/restore (the live store keeps a
 * second encrypted entries copy for exactly this purpose).
 */
export async function runMigrations(
  adapter: StorageAdapter,
  migrations: Migration[],
): Promise<MigrationResult> {
  const raw = await adapter.getItem(SCHEMA_VERSION_KEY);
  const fromVersion = raw === null ? 0 : Number(raw);
  if (!Number.isInteger(fromVersion) || fromVersion < 0) {
    return { ok: false, fromVersion, failedAtVersion: fromVersion, error: "corrupt schema version" };
  }
  const pending = migrations
    .slice()
    .sort((a, b) => a.toVersion - b.toVersion)
    .filter((m) => m.toVersion > fromVersion);

  let current = fromVersion;
  for (const migration of pending) {
    if (migration.toVersion !== current + 1) {
      return {
        ok: false,
        fromVersion,
        failedAtVersion: current,
        error: `migration gap: expected toVersion ${current + 1}, found ${migration.toVersion}`,
      };
    }
    try {
      await migration.run(adapter);
      await adapter.setItem(SCHEMA_VERSION_KEY, String(migration.toVersion));
      current = migration.toVersion;
    } catch (err) {
      return {
        ok: false,
        fromVersion,
        failedAtVersion: current,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
  return { ok: true, fromVersion, toVersion: current, applied: pending.length };
}

/**
 * Corrupt-store recovery: attempt to parse; on failure invoke the recovery
 * policy instead of crashing the app. `fallback` is the safe empty state.
 */
export async function safelyParse<T>(
  adapter: StorageAdapter,
  key: string,
  parse: (raw: string) => T | null,
  fallback: T,
): Promise<T> {
  const quarantine = async (payload: string) => {
    try {
      await adapter.setItem(`${key}.corrupt`, payload);
    } catch {
      // quarantine is best-effort; never mask the primary result
    }
  };
  try {
    const raw = await adapter.getItem(key);
    if (raw === null) return fallback;
    const parsed = parse(raw);
    if (parsed === null) {
      await quarantine(raw);
      return fallback;
    }
    return parsed;
  } catch {
    return fallback;
  }
}
