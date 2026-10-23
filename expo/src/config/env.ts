/**
 * Stage 3 configuration — validated, documented, and honest about what is
 * missing. Only EXPO_PUBLIC_* variables are readable in client code; they are
 * public by design (anon keys + URLs). Server-side secrets never appear here.
 *
 * `readClientConfig` is pure and testable: the app calls it at startup with
 * `process.env` and renders the config error state if validation fails.
 */

export type ClientConfig = {
  /** Cloud sync is optional: absent Supabase config means offline-capable mode, not an error. */
  cloudSync: { supabaseUrl: string; supabaseAnonKey: string } | null;
  /** Rork AI gateway (cloud-AI engine). Optional — CV/manual engines don't need it. */
  aiGateway: { baseUrl: string; appKey: string } | null;
  mode: "full" | "offline-first";
};

export type ConfigIssue = { key: string; problem: string };

export type ConfigRead =
  | { ok: true; config: ClientConfig }
  | { ok: false; issues: ConfigIssue[] };

function isHttpsUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:"; // localhost dev allowed
  } catch {
    return false;
  }
}

/**
 * Validate public client configuration. Hard errors are only for *contradictory*
 * config (e.g. a Supabase URL without its key); absent optional services simply
 * select `offline-first` mode — local mark entry never requires a cloud URL.
 */
export function readClientConfig(env: Record<string, string | undefined>): ConfigRead {
  const issues: ConfigIssue[] = [];
  const supabaseUrl = env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const supabaseAnonKey = env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";
  const aiBaseUrl = env.EXPO_PUBLIC_RORK_API_BASE_URL?.trim() ?? "";
  const aiAppKey = env.EXPO_PUBLIC_RORK_APP_KEY?.trim() ?? "";

  let cloudSync: ClientConfig["cloudSync"] = null;
  if (supabaseUrl || supabaseAnonKey) {
    if (!isHttpsUrl(supabaseUrl)) {
      issues.push({ key: "EXPO_PUBLIC_SUPABASE_URL", problem: "present but not a valid URL" });
    }
    if (!supabaseAnonKey) {
      issues.push({ key: "EXPO_PUBLIC_SUPABASE_ANON_KEY", problem: "missing while the Supabase URL is set" });
    }
    cloudSync = { supabaseUrl, supabaseAnonKey };
  }

  let aiGateway: ClientConfig["aiGateway"] = null;
  if (aiBaseUrl || aiAppKey) {
    if (!isHttpsUrl(aiBaseUrl)) {
      issues.push({ key: "EXPO_PUBLIC_RORK_API_BASE_URL", problem: "present but not a valid URL" });
    }
    if (!aiAppKey) {
      issues.push({ key: "EXPO_PUBLIC_RORK_APP_KEY", problem: "missing while the gateway URL is set" });
    }
    aiGateway = { baseUrl: aiBaseUrl, appKey: aiAppKey };
  }

  if (issues.length) return { ok: false, issues };
  return {
    ok: true,
    config: {
      cloudSync,
      aiGateway,
      mode: cloudSync ? "full" : "offline-first",
    },
  };
}
