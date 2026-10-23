import createContextHook from "@nkzw/create-context-hook";
import React, { useCallback, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import { getOrCreateKey, encryptString, decryptString, deriveSigningKey, signPayload, uuid4 } from "./crypto";
import type { CaptureRecord, ImageStore, ReconcileReport, SessionRecord } from "@/src/scanning/persist";
import { runReconcile } from "@/src/scanning/persist";

/** App-run marker: sessions still open from before this launch were interrupted. */
const APP_LAUNCH_MS = Date.now();
import { flushEvents, trackEvent } from "./observability";
import * as api from "./supabase";

/**
 * Offline-first data layer for the AI Mark Entry System.
 * - Records are encrypted (AES-256) before hitting device storage.
 * - Every entry carries a unique ID, device ID, timestamp, signature and
 *   correction version history — the original is never overwritten.
 * - A second encrypted copy of entries is kept as a local backup so a crash
 *   or corrupted store doesn't wipe unsynced records.
 * - Audit photos are stored locally only (configurable retention) and are
 *   stripped before anything is pushed to the cloud.
 * - Sync pushes signed records to Supabase (RLS-scoped by the teacher's JWT),
 *   flagging conflicts instead of overwriting them, then pulls any records
 *   missing locally (restore on a new device). Classes and rosters sync too.
 */

export type EntryVersion = {
  mark: number;
  note: string;
  at: string; // ISO timestamp
  by: string;
};

export type Entry = {
  id: string;
  studentName: string;
  classId: string;
  assessment: string;
  mark: number;
  maxMark: number;
  confidence: number;
  source: "ai" | "cv" | "manual";
  status: "confirmed" | "pending" | "flagged";
  createdAt: string;
  deviceId: string;
  signature: string;
  synced: boolean;
  /** Signature the server last acknowledged — a teacher's own correction after a clean sync pushes without a false conflict prompt. */
  syncedSignature?: string;
  versions: EntryVersion[];
  /** Local-only audit photo (base64); stripped before cloud sync. */
  image?: string;
  /** Set only after the entry was written into a completed export file. The
   * status stays `confirmed` (exported entries remain approved in derivations);
   * this timestamp records the export fact. */
  exportedAt?: string;
};

/** A record that changed on the server while the teacher edited it offline. */
export type Conflict = {
  id: string;
  studentName: string;
  assessment: string;
  localMark: number;
  localMax: number;
  localAt: string;
  serverMark: number | null;
  serverAt: string | null;
};

export type ClassRecord = {
  id: string;
  name: string;
  subject: string;
  grade: string;
  synced: boolean;
};

export type StudentRecord = {
  id: string;
  classId: string;
  name: string;
  ref?: string;
  synced: boolean;
};

export type Session = api.Session;

export type Settings = {
  onboarded: boolean;
  rememberMe: boolean;
  language: string;
  autoSync: boolean;
  offlineSession: boolean;
  consentAccepted: boolean;
  lastSyncAt: string | null;
  /** Sync-reminder threshold in days (spec default: 3). */
  syncPromptDays: number;
  /** How long audit photos are kept locally, in days. */
  retentionDays: number;
  /** Low-MP capture warning — the teacher can dismiss it for good (never nags). */
  warnLowMp: boolean;
  /** Detection engine the scan screen uses: cloud AI reader or the real CV (OCR) service. */
  visionEngine: "ai" | "cv";
  /** Self-hosted vision-service base URL used by CV mode, e.g. https://vision.school.edu */
  cvServiceUrl: string;
  /** Vision-service account email used for real sign-in against the server (CV mode). */
  cvAuthEmail: string;
  /** Vision-service 30-day refresh token — the password itself is never stored. */
  cvRefreshToken: string;
  /** Stage 2 theme preference; "system" follows the OS appearance. */
  theme: "system" | "light" | "dark";
};

const ENTRIES_KEY = "marks.entries.v1";
const BACKUP_KEY = "marks.entries.backup.v1";
const CLASSES_KEY = "marks.classes.v1";
const STUDENTS_KEY = "marks.students.v1";
const SETTINGS_KEY = "marks.settings.v1";
const DEVICE_KEY = "marks.deviceId.v1";
const SESSION_KEY = "marks.session.v1";
const SCAN_SESSIONS_KEY = "marks.scansessions.v1";
const SCAN_CAPTURES_KEY = "marks.scancaptures.v1";

const defaultSettings: Settings = {
  onboarded: false,
  rememberMe: false,
  language: "en",
  autoSync: true,
  offlineSession: false,
  consentAccepted: false,
  lastSyncAt: null,
  syncPromptDays: 3,
  retentionDays: 90,
  warnLowMp: true,
  visionEngine: "ai",
  cvServiceUrl: "",
  cvAuthEmail: "",
  cvRefreshToken: "",
  theme: "system",
};

/**
 * Record signing: keyed HMAC-SHA256 with a secret derived from the device
 * encryption key, so tampering with stored records is detectable. Replaced by
 * hardware-backed keys in the dev-build release (same call shape).
 */
function sign(record: Omit<Entry, "signature">, masterKey: number[]): string {
  const payload = `${record.id}|${record.studentName}|${record.mark}|${record.createdAt}|${record.deviceId}`;
  const secret = masterKey.length ? deriveSigningKey(masterKey) : utf8Bytes(record.deviceId || "marks");
  return signPayload(secret, payload);
}

function utf8Bytes(s: string): number[] {
  return Array.from(s, (ch) => ch.charCodeAt(0) & 0xff);
}

/** UUID v4 from the crypto pool — backend id columns are uuid-shaped. */
const makeId = uuid4;

type SyncResult = "synced" | "local" | "offline" | "error";

export const [StoreProvider, useStore] = createContextHook(() => {
  const [ready, setReady] = useState<boolean>(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [classList, setClassList] = useState<ClassRecord[]>([]);
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [deviceId, setDeviceId] = useState<string>("");
  const [session, setSessionState] = useState<Session | null>(null);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [online, setOnline] = useState<boolean | null>(null);
  // Stage 5: scan sessions + capture records (metadata only — image bytes live
  // in the platform ImageStore, never in the encrypted KV store).
  const [scanSessions, setScanSessions] = useState<SessionRecord[]>([]);
  const [scanCaptures, setScanCaptures] = useState<CaptureRecord[]>([]);
  const keyRef = useRef<number[]>([]);
  const syncRef = useRef<(auto: boolean) => Promise<SyncResult>>(async () => "synced");

  /** Audit photos past the retention window are dropped from local storage. */
  const applyRetention = (list: Entry[], days: number): Entry[] => {
    const cutoff = Date.now() - days * 86_400_000;
    return list.map((e) => (e.image && new Date(e.createdAt).getTime() < cutoff ? { ...e, image: undefined } : e));
  };

  // Hydrate from encrypted local storage on launch.
  useEffect(() => {
    (async () => {
      try {
        const key = await getOrCreateKey();
        keyRef.current = key;
        const [e, s, d, sess, cls, stu, scanSess, scanCaps] = await Promise.all([
          AsyncStorage.getItem(ENTRIES_KEY),
          AsyncStorage.getItem(SETTINGS_KEY),
          AsyncStorage.getItem(DEVICE_KEY),
          AsyncStorage.getItem(SESSION_KEY),
          AsyncStorage.getItem(CLASSES_KEY),
          AsyncStorage.getItem(STUDENTS_KEY),
          AsyncStorage.getItem(SCAN_SESSIONS_KEY),
          AsyncStorage.getItem(SCAN_CAPTURES_KEY),
        ]);
        // Settings: plaintext JSON (legacy installs) or AES-256 blob — the CV
        // refresh token and account email must not sit in readable storage.
        const parseSettings = (raw: string | null): Settings => {
          if (!raw) return defaultSettings;
          try {
            const plain = raw.startsWith("{") ? raw : decryptString(key, raw);
            return { ...defaultSettings, ...(JSON.parse(plain) as Partial<Settings>) };
          } catch {
            return defaultSettings;
          }
        };
        const loadEntries = (raw: string | null): Entry[] => {
          if (!raw) return [];
          try {
            const parsed = JSON.parse(decryptString(key, raw)) as Entry[];
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        };

        let parsedEntries = loadEntries(e);
        // Main store corrupted → restore from the backup copy.
        if (parsedEntries.length === 0 && e) {
          const backup = await AsyncStorage.getItem(BACKUP_KEY);
          if (backup && backup !== e) parsedEntries = loadEntries(backup);
        }
        const s0 = parseSettings(s);
        setEntries(applyRetention(parsedEntries, s0.retentionDays));
        setSettings(s0);
        if (cls) {
          try {
            const parsed = JSON.parse(decryptString(key, cls)) as ClassRecord[];
            if (Array.isArray(parsed)) setClassList(parsed);
          } catch {
            // corrupted classes ignored
          }
        }
        if (stu) {
          try {
            const parsed = JSON.parse(decryptString(key, stu)) as StudentRecord[];
            if (Array.isArray(parsed)) setStudents(parsed);
          } catch {
            // corrupted students ignored
          }
        }
        if (sess) {
          try {
            setSessionState(JSON.parse(decryptString(key, sess)) as Session);
          } catch {
            // ignore corrupted session
          }
        }
        if (scanSess) {
          try {
            const parsed = JSON.parse(decryptString(key, scanSess)) as SessionRecord[];
            if (Array.isArray(parsed)) setScanSessions(parsed);
          } catch {
            // ignore corrupted scan sessions
          }
        }
        if (scanCaps) {
          try {
            const parsed = JSON.parse(decryptString(key, scanCaps)) as CaptureRecord[];
            if (Array.isArray(parsed)) setScanCaptures(parsed);
          } catch {
            // ignore corrupted capture records
          }
        }
        let id = d;
        if (!id) {
          id = `dev-${makeId()}`;
          await AsyncStorage.setItem(DEVICE_KEY, id);
        }
        setDeviceId(id);
      } catch (err) {
        console.warn("store hydrate failed:", err);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  // Persist (encrypted, plus a backup copy) on change.
  useEffect(() => {
    if (!ready || !keyRef.current.length) return;
    const blob = encryptString(keyRef.current, JSON.stringify(entries));
    AsyncStorage.setItem(ENTRIES_KEY, blob).catch((e: unknown) => console.warn("entries persist failed:", e));
    AsyncStorage.setItem(BACKUP_KEY, blob).catch(() => {});
  }, [entries, ready]);

  useEffect(() => {
    if (!ready || !keyRef.current.length) return;
    AsyncStorage.setItem(CLASSES_KEY, encryptString(keyRef.current, JSON.stringify(classList))).catch(() => {});
  }, [classList, ready]);

  useEffect(() => {
    if (!ready || !keyRef.current.length) return;
    AsyncStorage.setItem(STUDENTS_KEY, encryptString(keyRef.current, JSON.stringify(students))).catch(() => {});
  }, [students, ready]);

  useEffect(() => {
    if (!ready || !keyRef.current.length) return;
    AsyncStorage.setItem(SCAN_SESSIONS_KEY, encryptString(keyRef.current, JSON.stringify(scanSessions))).catch(() => {});
  }, [scanSessions, ready]);

  useEffect(() => {
    if (!ready || !keyRef.current.length) return;
    AsyncStorage.setItem(SCAN_CAPTURES_KEY, encryptString(keyRef.current, JSON.stringify(scanCaptures))).catch(() => {});
  }, [scanCaptures, ready]);

  useEffect(() => {
    if (!ready) return;
    const blob = keyRef.current.length
      ? encryptString(keyRef.current, JSON.stringify(settings))
      : JSON.stringify(settings);
    AsyncStorage.setItem(SETTINGS_KEY, blob).catch((e: unknown) =>
      console.warn("settings persist failed:", e),
    );
  }, [settings, ready]);

  const setSession = useCallback((s: Session | null) => {
    setSessionState(s);
    if (s && keyRef.current.length) {
      AsyncStorage.setItem(SESSION_KEY, encryptString(keyRef.current, JSON.stringify(s))).catch(() => {});
    } else {
      AsyncStorage.removeItem(SESSION_KEY).catch(() => {});
    }
  }, []);

  const addEntry = useCallback(
    (input: {
      studentName: string;
      classId: string;
      assessment: string;
      mark: number;
      maxMark: number;
      confidence: number;
      source: "ai" | "cv" | "manual";
      status?: "confirmed" | "pending" | "flagged";
      image?: string;
    }): Entry => {
      const base: Omit<Entry, "signature"> = {
        id: makeId(),
        ...input,
        status: input.status ?? (input.confidence >= 85 ? "confirmed" : "flagged"),
        createdAt: new Date().toISOString(),
        deviceId: deviceId || "unknown-device",
        synced: false,
        versions: [
          { mark: input.mark, note: "Original entry", at: new Date().toISOString(), by: session?.name ?? "Teacher" },
        ],
      };
      const entry: Entry = { ...base, signature: sign(base, keyRef.current) };
      setEntries((prev) => [entry, ...prev]);
      trackEvent("record_saved", { source: input.source, status: entry.status });
      return entry;
    },
    [deviceId, session],
  );

  /** Correction flow: creates a new signed version; the original is preserved. */
  const correctEntry = useCallback(
    (id: string, newMark: number, note: string) => {
      setEntries((prev) =>
        prev.map((e) => {
          if (e.id !== id) return e;
          const versions: EntryVersion[] = [
            ...e.versions,
            { mark: newMark, note, at: new Date().toISOString(), by: session?.name ?? "Teacher" },
          ];
          const base: Omit<Entry, "signature"> = { ...e, mark: newMark, versions, synced: false };
          return { ...base, signature: sign(base, keyRef.current) };
        }),
      );
    },
    [session],
  );

  const markSynced = useCallback((ids: string[]) => {
    const set = new Set(ids);
    setEntries((prev) =>
      prev.map((e) => (set.has(e.id) ? { ...e, synced: true, syncedSignature: e.signature } : e)),
    );
  }, []);

  /** Marks confirmed entries as exported — call only after the export file exists. */
  const markExported = useCallback((ids: string[]) => {
    const set = new Set(ids);
    const at = new Date().toISOString();
    setEntries((prev) =>
      prev.map((e) =>
        set.has(e.id) && e.status === "confirmed" ? { ...e, exportedAt: at } : e,
      ),
    );
  }, []);

  /** Resolves a sync conflict: keep the teacher's edit (force-push) or take the server version. */
  const resolveConflict = useCallback(
    async (id: string, choice: "mine" | "server"): Promise<boolean> => {
      if (!session) return false;
      const entry = entries.find((e) => e.id === id);
      try {
        if (choice === "mine") {
          if (!entry) return false;
          const { image, ...payloadEntry } = entry;
          const res = await api.rest(session.token, "mark_entries?on_conflict=id", {
            method: "POST",
            body: [
              {
                id: entry.id,
                user_id: undefined,
                payload: payloadEntry,
                signature: entry.signature,
                device_id: entry.deviceId,
                mark: entry.mark,
                created_at: entry.createdAt,
                updated_at: new Date().toISOString(),
              },
            ],
            prefer: "resolution=merge-duplicates,return=minimal",
          });
          if (!res.ok && res.status !== 201) return false;
          markSynced([id]);
        } else {
          const res = await api.rest<{ payload: Entry | null }[]>(
            session.token,
            `mark_entries?id=eq.${id}&select=payload`,
          );
          const remote = Array.isArray(res.data) ? res.data[0]?.payload : undefined;
          setEntries((prev) =>
            remote
              ? prev.map((e) => (e.id === id ? { ...remote, synced: true } : e))
              : prev.filter((e) => e.id !== id),
          );
        }
        setConflicts((prev) => prev.filter((c) => c.id !== id));
        return true;
      } catch {
        return false;
      }
    },
    [session, entries, markSynced],
  );

  /**
   * Pushes unsynced signed records, flags conflicts (never overwrites), pushes
   * correction version history, syncs classes/rosters, then pulls any cloud
   * records missing locally so a new device restores.
   */
  const syncNow = useCallback(
    async (auto = false): Promise<SyncResult> => {
      void auto;
      if (syncing) return "synced";
      const queue = entries.filter((e) => !e.synced);
      if (!session) {
        // No account yet: records stay unsynced locally (no fake sync) and
        // will push on the first real sign-in.
        return queue.length > 0 ? "local" : "synced";
      }
      setSyncing(true);
      try {
        const reachable = await api.isOnline();
        setOnline(reachable);
        if (!reachable) return "offline";

        // Refresh the JWT only when it's about to expire (2 min margin) so
        // routine syncs don't churn tokens server-side.
        let token = session.token;
        const exp = api.jwtExpiresAt(session.token);
        if (session.refreshToken && exp - Date.now() / 1000 < 120) {
          const refreshed = await api.refreshSession(session.refreshToken);
          if (refreshed.session) {
            setSession(refreshed.session);
            token = refreshed.session.token;
          }
        }

        // --- Entries: conflict check, then push ---
        if (queue.length > 0) {
          const ids = queue.map((e) => `"${e.id}"`).join(",");
          const existing = await api.rest<
            { id: string; signature: string; mark: number; updated_at: string }[]
          >(token, `mark_entries?id=in.(${ids})&select=id,signature,mark,updated_at`);
          const server = Array.isArray(existing.data) ? existing.data : [];

          // A signature mismatch alone is NOT a conflict: a correction made on
          // this device legitimately changes the signature. Only a differing
          // mark (server moved while we edited) needs human resolution.
          const alreadySynced = server
            .filter((r) => queue.some((e) => e.id === r.id && e.signature === r.signature))
            .map((r) => r.id);
          if (alreadySynced.length > 0) markSynced(alreadySynced);

          // True conflict only when the server moved past what this device last
          // synced (syncedSignature). A teacher's own correction after a clean
          // sync differs from the server copy by design — it pushes, no prompt.
          const conflictIds = server.filter((r) => {
            const local = queue.find((e) => e.id === r.id);
            return (
              local &&
              local.signature !== r.signature &&
              local.mark !== r.mark &&
              r.signature !== (local.syncedSignature ?? local.signature)
            );
          });
          if (conflictIds.length > 0) {
            setConflicts((prev) => {
              const known = new Set(prev.map((c) => c.id));
              const fresh = conflictIds
                .filter((c) => !known.has(c.id))
                .map((c) => {
                  const local = queue.find((e) => e.id === c.id)!;
                  return {
                    id: c.id,
                    studentName: local.studentName,
                    assessment: local.assessment,
                    localMark: local.mark,
                    localMax: local.maxMark,
                    localAt: local.createdAt,
                    serverMark: c.mark,
                    serverAt: c.updated_at,
                  } satisfies Conflict;
                });
              return [...prev, ...fresh];
            });
          }

          const pushable = queue.filter(
            (e) => !conflictIds.some((c) => c.id === e.id) && !alreadySynced.includes(e.id),
          );
          if (pushable.length > 0) {
            const rows = pushable.map((e) => {
              const { image, ...payloadEntry } = e; // audit photos stay local-only
              return {
                id: e.id,
                user_id: undefined,
                payload: payloadEntry,
                signature: e.signature,
                device_id: e.deviceId,
                mark: e.mark,
                created_at: e.createdAt,
                updated_at: new Date().toISOString(),
              };
            });
            const res = await api.rest(token, "mark_entries?on_conflict=id", {
              method: "POST",
              body: rows,
              prefer: "resolution=merge-duplicates,return=minimal",
            });
            if (!res.ok && res.status !== 201) return "error";
            await api.rest(token, "sync_log", {
              method: "POST",
              body: { device_id: deviceId, pushed: pushable.length },
              prefer: "return=minimal",
            });
            // Correction history goes to its own append-only table (best effort —
            // the payload also carries versions[] so nothing is lost if this fails).
            const versionRows = pushable.flatMap((e) =>
              e.versions.map((v, i) => ({
                entry_id: e.id,
                user_id: undefined,
                version_index: i,
                mark: v.mark,
                note: v.note,
                recorded_by: v.by,
                recorded_at: v.at,
              })),
            );
            if (versionRows.length > 0) {
              await api.rest(token, "mark_entry_versions?on_conflict=entry_id,version_index", {
                method: "POST",
                body: versionRows,
                prefer: "resolution=merge-duplicates,return=minimal",
              });
            }
            markSynced(pushable.map((e) => e.id));
            trackEvent("sync_completed", { pushed: pushable.length });
          }
        }

        // --- Classes + rosters: push, then pull ---
        const cQueue = classList.filter((c) => !c.synced);
        if (cQueue.length > 0) {
          await api.rest(token, "classes?on_conflict=id", {
            method: "POST",
            body: cQueue.map((c) => ({ id: c.id, user_id: undefined, name: c.name, subject: c.subject, grade: c.grade })),
            prefer: "resolution=merge-duplicates,return=minimal",
          });
          setClassList((prev) => prev.map((c) => (cQueue.some((q) => q.id === c.id) ? { ...c, synced: true } : c)));
        }
        const sQueue = students.filter((s) => !s.synced);
        if (sQueue.length > 0) {
          await api.rest(token, "students?on_conflict=id", {
            method: "POST",
            body: sQueue.map((s) => ({ id: s.id, user_id: undefined, class_id: s.classId, name: s.name, student_ref: s.ref ?? null })),
            prefer: "resolution=merge-duplicates,return=minimal",
          });
          setStudents((prev) => prev.map((s) => (sQueue.some((q) => q.id === s.id) ? { ...s, synced: true } : s)));
        }

        // Pull records this device doesn't have yet (restore on new device).
        // Delta pull: only rows changed since the last successful sync.
        const delta = settings.lastSyncAt ? `&updated_at=gte.${encodeURIComponent(settings.lastSyncAt)}` : "";
        const remoteEntries = await api.rest<{ payload: Entry | null }[]>(
          token,
          `mark_entries?select=payload&order=updated_at.desc&limit=1000${delta}`,
        );
        const remoteList = (Array.isArray(remoteEntries.data) ? remoteEntries.data : [])
          .map((r) => r.payload)
          .filter((p): p is Entry => !!p && !!p.id);
        if (remoteList.length > 0) {
          setEntries((prev) => {
            const have = new Set(prev.map((e) => e.id));
            const missing = remoteList
              .filter((p) => !have.has(p.id))
              .map((p) => ({ ...p, image: undefined })); // photos are device-local
            return missing.length > 0 ? [...missing, ...prev] : prev;
          });
        }

        const remoteClasses = await api.rest<
          { id: string; name: string; subject: string | null; grade: string | null }[]
        >(token, "classes?select=*&order=updated_at.desc&limit=500");
        if (Array.isArray(remoteClasses.data) && remoteClasses.data.length > 0) {
          setClassList((prev) => {
            const have = new Set(prev.map((c) => c.id));
            const missing = remoteClasses.data!.filter((c) => !have.has(c.id));
            return missing.length > 0
              ? [
                  ...missing.map((c) => ({
                    id: c.id,
                    name: c.name,
                    subject: c.subject ?? "",
                    grade: c.grade ?? "",
                    synced: true,
                  })),
                  ...prev,
                ]
              : prev;
          });
        }
        const remoteStudents = await api.rest<
          { id: string; class_id: string; name: string; student_ref: string | null }[]
        >(token, "students?select=*&order=updated_at.desc&limit=2000");
        if (Array.isArray(remoteStudents.data) && remoteStudents.data.length > 0) {
          setStudents((prev) => {
            const have = new Set(prev.map((s) => s.id));
            const missing = remoteStudents.data!.filter((s) => !have.has(s.id));
            return missing.length > 0
              ? [
                  ...missing.map((s) => ({
                    id: s.id,
                    classId: s.class_id,
                    name: s.name,
                    ref: s.student_ref ?? undefined,
                    synced: true,
                  })),
                  ...prev,
                ]
              : prev;
          });
        }

        setSettings((s) => ({ ...s, lastSyncAt: new Date().toISOString() }));
        void flushEvents(token, deviceId);
        return "synced";
      } catch {
        return "error";
      } finally {
        setSyncing(false);
      }
    },
    [entries, classList, students, settings.lastSyncAt, session, syncing, deviceId, markSynced, setSession],
  );
  syncRef.current = syncNow;

  // --- Class + roster management (works offline, syncs when online) ---
  const addClass = useCallback(
    (name: string, subject: string, grade: string): ClassRecord => {
      const record: ClassRecord = { id: makeId(), name, subject, grade, synced: false };
      setClassList((prev) => [record, ...prev]);
      if (session) {
        void api
          .rest(session.token, "classes?on_conflict=id", {
            method: "POST",
            body: [{ id: record.id, user_id: undefined, name, subject, grade }],
            prefer: "resolution=merge-duplicates,return=minimal",
          })
          .then((r) => {
            if (r.ok || r.status === 201) setClassList((prev) => prev.map((c) => (c.id === record.id ? { ...c, synced: true } : c)));
          });
      }
      return record;
    },
    [session],
  );

  const addStudents = useCallback(
    (classId: string, names: { name: string; ref?: string }[]): number => {
      // Stable-identifier dedupe: a record whose ref matches an existing
      // student of this class (or an earlier record in this batch) is skipped,
      // never duplicated. Name-only matches are NOT deduped here — the import
      // wizard surfaces them for explicit teacher resolution.
      const byRef = new Set(
        students
          .filter((s) => s.classId === classId && s.ref?.trim())
          .map((s) => s.ref!.trim().toLowerCase()),
      );
      const records: StudentRecord[] = [];
      for (const n of names) {
        const ref = n.ref?.trim();
        if (ref) {
          const key = ref.toLowerCase();
          if (byRef.has(key)) continue;
          byRef.add(key);
        }
        records.push({ id: makeId(), classId, name: n.name, ref: n.ref, synced: false });
      }
      if (records.length === 0) return 0;
      setStudents((prev) => [...records, ...prev]);
      if (session && records.length > 0) {
        void api
          .rest(session.token, "students?on_conflict=id", {
            method: "POST",
            body: records.map((s) => ({ id: s.id, user_id: undefined, class_id: s.classId, name: s.name, student_ref: s.ref ?? null })),
            prefer: "resolution=merge-duplicates,return=minimal",
          })
          .then((r) => {
            if (r.ok || r.status === 201) {
              const ids = new Set(records.map((s) => s.id));
              setStudents((prev) => prev.map((s) => (ids.has(s.id) ? { ...s, synced: true } : s)));
            }
          });
      }
      return records.length;
    },
    [session, students],
  );

  /**
   * Atomic import application: creates AND confirmed updates land in ONE
   * students-state write (persisted as a single encrypted storage write), so a
   * crash mid-import leaves either the old or the new roster — never a partial
   * one. This is the rollback guarantee of the current storage architecture.
   */
  const importStudents = useCallback(
    (
      classId: string,
      creates: { name: string; ref?: string }[],
      updates: { id: string; name: string; ref?: string }[],
    ): number => {
      const updateById = new Map(updates.map((u) => [u.id, u]));
      const newRecords: StudentRecord[] = creates.map((n) => ({
        id: makeId(),
        classId,
        name: n.name,
        ref: n.ref,
        synced: false,
      }));
      setStudents((prev) =>
        [
          ...prev.map((s) => {
            const u = updateById.get(s.id);
            return u ? { ...s, name: u.name, ref: u.ref ?? s.ref, synced: false } : s;
          }),
          ...newRecords,
        ]
      );
      if (session && (newRecords.length > 0 || updates.length > 0)) {
        const rows = [
          ...newRecords.map((s) => ({ id: s.id, user_id: undefined, class_id: s.classId, name: s.name, student_ref: s.ref ?? null })),
          ...updates.map((u) => ({ id: u.id, user_id: undefined, class_id: classId, name: u.name, student_ref: u.ref ?? null })),
        ];
        void api
          .rest(session.token, "students?on_conflict=id", {
            method: "POST",
            body: rows,
            prefer: "resolution=merge-duplicates,return=minimal",
          })
          .then((r) => {
            if (r.ok || r.status === 201) {
              const ids = new Set(rows.map((s) => s.id));
              setStudents((prev) => prev.map((s) => (ids.has(s.id) ? { ...s, synced: true } : s)));
            }
          });
      }
      return newRecords.length + updates.length;
    },
    [session],
  );

  const deleteClass = useCallback(
    (id: string) => {
      setClassList((prev) => prev.filter((c) => c.id !== id));
      setStudents((prev) => prev.filter((s) => s.classId !== id));
      if (session) {
        void api.rest(session.token, `students?class_id=eq.${id}`, { method: "DELETE" });
        void api.rest(session.token, `classes?id=eq.${id}`, { method: "DELETE" });
      }
    },
    [session],
  );

  /** Roster for a class as stored locally — empty means no students yet (no sample data anywhere). */
  const rosterOf = useCallback((classId: string) => students.filter((s) => s.classId === classId), [students]);

  const unsyncedCount = entries.filter((e) => !e.synced).length;
  const unsyncedOldestAt =
    entries.filter((e) => !e.synced).reduce<string | null>((oldest, e) => (!oldest || e.createdAt < oldest ? e.createdAt : oldest), null);

  // Auto-sync: retry shortly after launch and periodically while unsynced records exist.
  useEffect(() => {
    if (!ready || !settings.autoSync || unsyncedCount === 0) return;
    const timer = setTimeout(() => void syncRef.current(true), 4000);
    const interval = setInterval(() => void syncRef.current(true), 45000);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, settings.autoSync, unsyncedCount]);

  // Real-time connectivity: react to the network instead of only polling —
  // queued records push the moment the teacher is back online, and the online
  // badge reflects the actual radio state.
  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => {
      const reachable = state.isInternetReachable === true;
      setOnline(reachable);
      if (reachable && settings.autoSync && unsyncedCount > 0) void syncRef.current(true);
    });
    void NetInfo.fetch().then((state) => setOnline(state.isInternetReachable === true));
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.autoSync, unsyncedCount]);

  /**
   * Data-deletion request: removes ALL the teacher's cloud records (entries,
   * classes, rosters — versions cascade with entries), then wipes every local
   * store including the backup copy, and signs the session out.
   */
  const deleteCloudData = useCallback(async (): Promise<boolean> => {
    const wipeLocal = () => {
      setEntries([]);
      setClassList([]);
      setStudents([]);
      setConflicts([]);
      void AsyncStorage.multiRemove([ENTRIES_KEY, BACKUP_KEY, CLASSES_KEY, STUDENTS_KEY]).catch(() => {});
    };
    if (!session) {
      wipeLocal();
      return true;
    }
    const results = await Promise.all([
      api.rest(session.token, "mark_entries", { method: "DELETE" }),
      api.rest(session.token, "classes", { method: "DELETE" }),
      api.rest(session.token, "students", { method: "DELETE" }),
    ]);
    const ok = results.every((r) => r.ok || r.status === 204 || r.status === 404);
    if (ok) {
      wipeLocal();
      setSession(null);
    }
    return ok;
  }, [session, setSession]);

  /* ---------------- Stage 5: scan sessions & captures ---------------- */

  const startScanSession = useCallback(
    (classId: string, assessment: string, paperType: "ordinary" | "omr"): SessionRecord => {
      const s: SessionRecord = {
        id: makeId(),
        classId,
        assessment,
        paperType,
        startedAt: new Date().toISOString(),
        status: "active",
      };
      setScanSessions((prev) => [s, ...prev]);
      return s;
    },
    [],
  );

  /** Pause/resume/end; `status` also covers "interrupted" from reconcile. */
  const setScanSessionStatus = useCallback((id: string, status: SessionRecord["status"]) => {
    setScanSessions((prev) =>
      prev.map((s) =>
        s.id === id
          ? { ...s, status, endedAt: status === "completed" || status === "interrupted" ? new Date().toISOString() : s.endedAt }
          : s,
      ),
    );
  }, []);

  const addScanCapture = useCallback((record: CaptureRecord) => {
    setScanCaptures((prev) => [record, ...prev]);
  }, []);

  const patchScanCapture = useCallback((id: string, patch: Partial<CaptureRecord>) => {
    setScanCaptures((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }, []);

  const removeScanCapture = useCallback((id: string) => {
    setScanCaptures((prev) => prev.filter((c) => c.id !== id));
  }, []);

  /** Startup reconciliation against the platform image store (missing files,
   * orphaned image debris, interrupted sessions). */
  const reconcileScans = useCallback(
    async (images: ImageStore): Promise<ReconcileReport> => {
      const { sessions, captures, report } = await runReconcile({
        sessions: scanSessions,
        captures: scanCaptures,
        images,
        launchedAtMs: APP_LAUNCH_MS,
        nowIso: new Date().toISOString(),
      });
      setScanSessions(sessions);
      setScanCaptures(captures);
      return report;
    },
    [scanSessions, scanCaptures],
  );

  return {
    ready,
    entries,
    unsynced: entries.filter((e) => !e.synced),
    unsyncedCount,
    unsyncedOldestAt,
    settings,
    setSettings,
    deviceId,
    session,
    setSession,
    conflicts,
    syncing,
    online,
    addEntry,
    correctEntry,
    resolveConflict,
    syncNow,
    markExported,
    deleteCloudData,
    classList,
    students,
    addClass,
    addStudents,
    importStudents,
    deleteClass,
    rosterOf,
    scanSessions,
    scanCaptures,
    startScanSession,
    setScanSessionStatus,
    addScanCapture,
    patchScanCapture,
    removeScanCapture,
    reconcileScans,
  };
});
