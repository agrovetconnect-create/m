# Stage 3 — Configuration & Environment Management
**AI Mark Entry System.**

## 1. Strategy

| Build | Config source | Notes |
|---|---|---|
| Dev (Expo Go / web) | `.env` in `expo/` (git-ignored) + Rork-injected `EXPO_PUBLIC_*` | hot reload picks up changes |
| Test | hardcoded/env-free — `readClientConfig({})` yields offline-first mode | tests never depend on real endpoints |
| Production mobile | EAS/app-store build env | same `EXPO_PUBLIC_*` names, values in build config |
| Web export | build-time env | inlined into the bundle at build, not runtime |

Only variables prefixed `EXPO_PUBLIC_` reach client code (Expo inlines them at build
time). There are **no** server-only secrets in this client app: the Supabase *anon* key
is public by design (RLS enforces authorization server-side).

## 2. Variables (documented in `expo/.env.example`)

| Variable | Required | Purpose |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | optional | cloud sync + auth; absent → offline-first mode |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | with URL | public anon key; **never** the service-role key |
| `EXPO_PUBLIC_RORK_API_BASE_URL` | optional | cloud-AI engine gateway |
| `EXPO_PUBLIC_RORK_APP_KEY` | with URL | gateway app key |
| `EXPO_PUBLIC_RORK_AUTH_URL` / `_FUNCTIONS_URL` / `_TOOLKIT_URL` | injected | Rork platform plumbing |
| `EXPO_PUBLIC_PROJECT_ID` / `_TEAM_ID` | injected | platform identity |

The vision-service (self-hosted, optional) has its own env (`MARKBOOK_*`, documented in
`vision-service/DEPLOY.md`) — teacher's server, never in the client bundle.

## 3. Validation & failure behavior

`readClientConfig(env)` (`expo/src/config/env.ts`) runs at startup, unit-tested:
- **Contradictory config is a hard error** naming the offending key (e.g. Supabase URL
  without anon key) → app shows a configuration error state, not a silent degraded app.
- **Absent optional services are not errors** — mode becomes `offline-first`; local
  mark entry, review, approval, and export all function.
- Malformed URLs are rejected.
- Production builds must point at production endpoints: there is no dev-endpoint
  fallback baked into the config module — an empty/invalid value surfaces as a visible
  config issue, never a hidden default URL.

## 4. Secrets policy

- Real `.env` files are git-ignored (`expo/.gitignore`); `.env.example` ships instead.
- No secret values are printed in logs, health/version endpoints, error messages, or
  completion reports. The observability journal truncates messages and carries no PII.
- Database admin credentials / service-role keys do not exist client-side, full stop.
- Running without cloud: simply omit the optional variables — the app boots in
  offline-first mode and everything local works; sync and the cloud-AI engine show
  their honest unavailable states.
