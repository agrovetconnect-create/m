/**
 * Real computer vision mode: deterministic OCR served by the self-hosted
 * vision-service (OpenCV quality check → Tesseract OCR → regex extraction →
 * confidence gate). The service answers with the strict frame contract
 * (lib/vision-schema); a gated read — no paper, blurry/underexposed frame,
 * missing ID, zero marks, low confidence — never becomes a savable result.
 *
 * The service is auth-gated (its own teacher accounts, PBKDF2 + HMAC tokens):
 * this client signs in with real credentials, keeps the short-lived access
 * token in memory only, and silently refreshes it with the 30-day refresh
 * token the Settings screen persists. The password is never stored.
 */
import type { DetectionResult } from "@/lib/ai";
import { mapVisionFrame, frameHudOf, type VisionFrame, type FrameHud } from "./vision-schema";

export type VisionTokens = { accessToken: string; refreshToken: string };

export type CVError = "unreachable" | "unreadable" | "auth" | "quality" | null;

/** In-memory access-token cache — keyed per service+account, never persisted. */
let cachedAccess: { key: string; accessToken: string } | null = null;

const base = (url: string): string => url.replace(/\/+$/, "");

/** GET /vision/health — real reachability + OCR-availability probe (no auth). */
export async function visionHealth(serviceUrl: string): Promise<{ ok: boolean; ocr: boolean } | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(`${base(serviceUrl)}/vision/health`, { signal: ctrl.signal });
    if (!res.ok) return null;
    const json = (await res.json()) as { ok?: boolean; ocr?: boolean };
    return { ok: json.ok === true, ocr: json.ocr === true };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** POST /auth/login — real credential sign-in against the vision service. */
export async function visionLogin(serviceUrl: string, email: string, password: string): Promise<VisionTokens | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(`${base(serviceUrl)}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { access_token?: string; refresh_token?: string };
    if (!json.access_token || !json.refresh_token) return null;
    return { accessToken: json.access_token, refreshToken: json.refresh_token };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** POST /auth/refresh — exchange the 30-day refresh token for a fresh token pair. */
export async function visionRefresh(serviceUrl: string, refreshToken: string): Promise<VisionTokens | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(`${base(serviceUrl)}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { access_token?: string; refresh_token?: string };
    if (!json.access_token || !json.refresh_token) return null;
    return { accessToken: json.access_token, refreshToken: json.refresh_token };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * POST the captured frame to the vision-service (Bearer-authenticated) and map
 * the gated result. `hud` carries the frame contract's real values (quality,
 * confidence, latency, paper bounds) whenever the service answered — even for
 * gated reads — so the scan screen's live overlay stays truthful.
 */
export async function detectMarksCV(
  imageBase64: string,
  serviceUrl: string,
  accessToken?: string,
): Promise<{ result: DetectionResult | null; error: CVError; hud?: FrameHud }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const res = await fetch(`${base(serviceUrl)}/vision/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      signal: ctrl.signal,
      body: JSON.stringify({ imageB64: imageBase64 }),
    });
    if (res.status === 401) return { result: null, error: "auth" };
    if (res.status === 422) return { result: null, error: "unreadable" };
    if (!res.ok) return { result: null, error: "unreachable" };
    const frame = (await res.json()) as VisionFrame;
    const hud = frameHudOf(frame);
    const { result, reason } = mapVisionFrame(frame, "cv");
    // No paper in frame, or a blurry/underexposed capture: the teacher should
    // retake with steady lighting rather than fall back to typing.
    if (!result && (reason === "no_paper" || reason === "quality")) {
      return { result: null, error: "quality", hud };
    }
    return { result, error: null, hud };
  } catch {
    return { result: null, error: "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Full CV round-trip with the real token lifecycle: refresh (or report an auth
 * failure) when there is no valid session, rotate the refresh token through
 * `onTokens` so the app persists the newest one, and retry exactly once after
 * a 401 before surfacing the error.
 */
export async function visionAnalyze(
  imageBase64: string,
  opts: {
    url: string;
    email: string;
    refreshToken: string;
    /** Called whenever the service issues a new token pair — persist the refresh token. */
    onTokens?: (tokens: VisionTokens) => void;
  },
): Promise<{ result: DetectionResult | null; error: CVError; hud?: FrameHud }> {
  const key = `${opts.url}|${opts.email}`;

  const ensureToken = async (force: boolean): Promise<string | null> => {
    if (!force && cachedAccess && cachedAccess.key === key) return cachedAccess.accessToken;
    const fresh = await visionRefresh(opts.url, opts.refreshToken);
    if (!fresh) return null;
    cachedAccess = { key, accessToken: fresh.accessToken };
    opts.onTokens?.(fresh);
    return fresh.accessToken;
  };

  const first = await ensureToken(false);
  if (!first) return { result: null, error: "auth" };
  let out = await detectMarksCV(imageBase64, opts.url, first);
  if (out.error === "auth") {
    const second = await ensureToken(true);
    if (!second) return { result: null, error: "auth" };
    out = await detectMarksCV(imageBase64, opts.url, second);
  }
  return out;
}
