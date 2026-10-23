/**
 * Offline-first client observability: product events + crash/error capture.
 *
 * - No PII: only event names, counters, and truncated error messages travel.
 * - Events journal locally (capped) and sync to the RLS-protected
 *   `client_events` table whenever a signed-in session syncs — so Day 1/7/30
 *   retention and conversion funnels (signup → first scan → saved record)
 *   are computable from the teacher's own data, with nothing third-party.
 * - Global JS errors and unhandled rejections are captured as `client_error`
 *   events and re-dispatched so native crash behavior is preserved.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { rest } from "./supabase";

export type ClientEvent = {
  event: string;
  props: Record<string, string | number | boolean>;
  at: string;
};

const KEY = "obs.events.v1";
const CAP = 500;
const MAX_MESSAGE = 300;

let queue: ClientEvent[] | null = null;
let loading: Promise<void> | null = null;

async function ensureLoaded(): Promise<void> {
  if (queue) return;
  if (loading) return loading;
  loading = (async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      queue = raw ? (JSON.parse(raw) as ClientEvent[]) : [];
    } catch {
      queue = [];
    }
  })();
  await loading;
  loading = null;
}

function persist(): void {
  if (!queue) return;
  AsyncStorage.setItem(KEY, JSON.stringify(queue.slice(-CAP))).catch(() => {
    /* journaling must never throw into app code */
  });
}

/** Fire-and-forget product event (no PII in props). */
export function trackEvent(name: string, props: Record<string, string | number | boolean> = {}): void {
  void ensureLoaded().then(() => {
    queue?.push({ event: name, props, at: new Date().toISOString() });
    if (queue && queue.length > CAP) queue = queue.slice(-CAP);
    persist();
  });
}

/** Captures a caught error as a `client_error` event (message only, truncated). */
export function trackError(error: unknown, extra: Record<string, string | number | boolean> = {}): void {
  const message = typeof error === "object" && error !== null && "message" in error
    ? String((error as { message: unknown }).message)
    : String(error);
  trackEvent("client_error", { message: message.slice(0, MAX_MESSAGE), ...extra });
}

/**
 * Installs global handlers for JS errors (Hermes ErrorUtils) and unhandled
 * promise rejections (web/window). The original handler still runs, so a
 * fatal crash behaves exactly as before — we just record it first.
 */
export function installErrorHandlers(): void {
  const g = globalThis as { ErrorUtils?: { getGlobalHandler?: () => unknown; setGlobalHandler?: (h: unknown) => void } };
  const prev = g.ErrorUtils?.getGlobalHandler?.();
  g.ErrorUtils?.setGlobalHandler?.((error: unknown, isFatal?: boolean) => {
    trackError(error, { fatal: isFatal === true });
    if (typeof prev === "function") prev(error, isFatal);
  });
  if (typeof globalThis.addEventListener === "function") {
    globalThis.addEventListener("unhandledrejection", (e) => {
      const reason = (e as PromiseRejectionEvent).reason;
      trackError(reason, { fatal: false, kind: "unhandledrejection" });
    });
  }
}

/**
 * Pushes the journal to Supabase (RLS scopes rows to the caller via the
 * auth.uid() column default). Returns the number of events flushed; the
 * journal is only cleared on server acknowledgement, and flushes to a table
 * that doesn't exist yet are a harmless no-op (rows stay queued locally).
 */
export async function flushEvents(token: string, deviceId: string): Promise<number> {
  await ensureLoaded();
  if (!queue || queue.length === 0) return 0;
  const body = queue.map((e) => ({
    event: e.event,
    props: e.props,
    device_id: deviceId,
    created_at: e.at,
  }));
  const res = await rest(token, "client_events", { method: "POST", body, prefer: "return=minimal" });
  if (!res.ok) return 0;
  queue = [];
  persist();
  return body.length;
}
