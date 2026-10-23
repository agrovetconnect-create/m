/**
 * Supabase REST client (no SDK dependency — plain fetch).
 * Talks to the Supabase Auth API (JWT sessions) and PostgREST for data,
 * always scoped by Row Level Security via the bearer token.
 */

const URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";

export type Session = { token: string; refreshToken?: string; email: string; name: string };

type AuthJson = {
  access_token?: string;
  refresh_token?: string;
  user?: { email?: string; user_metadata?: { name?: string; full_name?: string } };
  msg?: string;
  error_description?: string;
  error?: string;
  message?: string;
};

function friendlyAuthError(json: AuthJson): string {
  const raw = json.msg ?? json.error_description ?? json.error ?? json.message ?? "Something went wrong";
  if (/invalid login|invalid credentials/i.test(raw)) return "Wrong email or password";
  if (/already registered/i.test(raw)) return "That email is already registered";
  if (/rate limit/i.test(raw)) return "Too many attempts — try again shortly";
  if (/network|fetch/i.test(raw)) return "No connection — try again";
  return raw;
}

/** Every request gets a hard timeout so a stalled network can't hang the UI. */
async function fetchTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function authPost(path: string, body: object): Promise<{ session?: Session; error?: string }> {
  try {
    const res = await fetchTimeout(
      `${URL}${path}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: ANON, Authorization: `Bearer ${ANON}` },
        body: JSON.stringify(body),
      },
      15_000,
    );
    const json = (await res.json()) as AuthJson;
    if (!res.ok || !json.access_token) return { error: friendlyAuthError(json) };
    const email = json.user?.email ?? "";
    const name = json.user?.user_metadata?.name ?? json.user?.user_metadata?.full_name ?? email.split("@")[0];
    return { session: { token: json.access_token, refreshToken: json.refresh_token, email, name } };
  } catch {
    return { error: "No connection — try again" };
  }
}

/** Creates an account (email + password + optional display name). */
export const signUp = (email: string, password: string, name?: string) =>
  authPost("/auth/v1/signup", { email, password, ...(name ? { data: { name } } : {}) });

/** Signs in with email + password; returns a JWT session. */
export const signIn = (email: string, password: string) =>
  authPost("/auth/v1/token?grant_type=password", { email, password });

/** Exchanges a refresh token for a fresh JWT (called when a session is about to expire). */
export const refreshSession = (refreshToken: string) =>
  authPost("/auth/v1/token?grant_type=refresh_token", { refresh_token: refreshToken });

/** Ends the session server-side. */
export async function signOut(token: string): Promise<void> {
  try {
    await fetchTimeout(
      `${URL}/auth/v1/logout`,
      { method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${token}` } },
      10_000,
    );
  } catch {
    // local sign-out still applies
  }
}

/**
 * Validates an access token and returns the real account (email + name).
 * Used after OAuth deep-links so we never trust tokens straight from a URL.
 */
export async function getUser(token: string): Promise<{ email: string; name: string } | null> {
  try {
    const res = await fetchTimeout(
      `${URL}/auth/v1/user`,
      { headers: { apikey: ANON, Authorization: `Bearer ${token}` } },
      10_000,
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { email?: string; user_metadata?: { name?: string; full_name?: string } };
    const email = json.email ?? "";
    if (!email) return null;
    return { email, name: json.user_metadata?.name ?? json.user_metadata?.full_name ?? email.split("@")[0] };
  } catch {
    return null;
  }
}

/**
 * Expiry (unix seconds) encoded in a JWT access token; 0 when undecodable, so
 * callers treat an unreadable token as expired and refresh it.
 */
export function jwtExpiresAt(token: string): number {
  const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const seg = (token.split(".")[1] ?? "").replace(/-/g, "+").replace(/_/g, "/");
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of seg) {
    if (ch === "=") break;
    const v = B64.indexOf(ch);
    if (v < 0) return 0;
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  try {
    // JWT claims are ASCII — plain char decoding, no TextDecoder needed on Hermes.
    const json = JSON.parse(out.map((b) => String.fromCharCode(b)).join("")) as { exp?: unknown };
    return typeof json.exp === "number" ? json.exp : 0;
  } catch {
    return 0;
  }
}

/** OAuth start URL for a social provider (must be enabled on the Supabase project). */
export const oauthUrl = (provider: "google" | "apple") => `${URL}/auth/v1/authorize?provider=${provider}`;

/** True when the Supabase API answers within the timeout. */
export async function isOnline(): Promise<boolean> {
  try {
    const res = await fetchTimeout(`${URL}/rest/v1/`, { headers: { apikey: ANON }, method: "HEAD" }, 8_000);
    return res.status < 500;
  } catch {
    return false;
  }
}

/** PostgREST request with the caller's JWT so RLS scopes every row. */
export async function rest<T = unknown>(
  token: string,
  path: string,
  init: { method?: string; body?: object; prefer?: string } = {},
): Promise<{ ok: boolean; status: number; data?: T }> {
  try {
    const res = await fetchTimeout(
      `${URL}/rest/v1/${path}`,
      {
        method: init.method ?? "GET",
        headers: {
          apikey: ANON,
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...(init.prefer ? { Prefer: init.prefer } : {}),
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
      },
      30_000,
    );
    if (!res.ok) return { ok: false, status: res.status };
    const data = res.status === 204 ? undefined : ((await res.json()) as T);
    return { ok: true, status: res.status, data };
  } catch {
    return { ok: false, status: 0 };
  }
}
