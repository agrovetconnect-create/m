# Stage 3 — Implementation Plan
**AI Mark Entry System · Application Foundation & Cross-Platform Infrastructure**
Written after Step Zero inspection; drives all Stage 3 code changes.

## Step Zero findings (verified in-repo)

1. **Framework/package manager:** React Native + Expo SDK 54 (TypeScript), expo-router,
   bun. One codebase targets iOS/Android/web (`web` is configured in `app.json`);
   react-native-web renders the same UI in browsers.
2. **Implemented already:** login/onboarding (real Supabase auth), Home, Marksheets
   (classes/roster/assessments), scan flow (web live viewfinder / native system camera,
   HUD, chain mode), review & approval, reports/history, settings, encrypted offline
   store + signed sync, 5-language i18n with RTL, observability.
3. **Design system:** token layer + ThemeProvider in `expo/src/design-system/`
   (Stage 2) — RN-native, reusable on Expo web as-is.
4. **PoC organization:** standalone Python package under
   `proof-of-concept/live-paper-detection/` (detector, state machine, tests) —
   preserved untouched; its state semantics are formalized as the app's scanning
   contract in this stage.
5. **Dependency compatibility:** no new native modules can be installed in this Expo Go
   environment — foundations must be pure TypeScript plus existing dependencies.
6. **Platform SDKs/build tools:** no Android SDK/iOS toolchain/EAS in this sandbox →
   native builds are BLOCKED; static checks + bun tests + web bundle are the verifiable
   surfaces.
7. **Environment variables:** `EXPO_PUBLIC_*` (Supabase URL/anon key, Rork gateway) are
   public client config; no server secrets in the client. Optional services (Supabase
   sync, vision-service) must degrade to fully-offline operation.
8. **Incomplete from earlier stages (unchanged):** real-camera PoC verification
   (BLOCKED: no hardware), dev-build items (Keychain keys, in-app native viewfinder),
   store accounts for billing/licensing, `client_events` migration (infra-side).

## Architecture decision summary (full rationale in STAGE_3_ARCHITECTURE_DECISIONS.md)

- **Shared UI, platform adapters at the edges.** One Expo app for Android/iOS/web.
  Platform differences live behind typed adapters (camera, files), never inline
  `Platform.OS` branching in business logic.
- **Windows desktop: deferred packaging, not a parallel app.** Per the Stage 1
  decision, the web build is wrapped with Tauri at packaging time. No Electron/Tauri
  scaffold is added now — it could not be built or verified in this environment, and a
  fake desktop target violates the honesty rules.
- **Storage: keep the approved encrypted store; formalize the seam.** The existing
  AES-256 store is the live `StorageAdapter`. Stage 3 adds the versioned adapter
  interface + migration runner so a SQLite (dev-build) adapter can replace the engine
  without touching call sites. No unverified encryption claims.
- **Camera/scanning: formalize the existing reality.** The web getUserMedia viewfinder
  and native system-camera paths become the two implementations of one typed
  `CameraAdapter`; the PoC state machine's semantics become the app-level
  `ScanningEvent`/`ScanState` contract.
- **Optional backend:** the FastAPI vision-service already exists (health, auth, rate
  limiting, tests). Stage 3 adds only a versioned `/version` endpoint; no new backend.

## Build order (Steps C–H)

1. Domain types + mark validation (pure, tested) — recognition engines reuse later.
2. Scanning boundary: `ScanningEvent` union + pure state machine adapter + tests.
3. Storage foundation: `StorageAdapter` + versioned migration runner + tests.
4. File boundary: `FileAdapter` + never-overwrite-source naming rules + tests.
5. Configuration: startup validation of `EXPO_PUBLIC_*` + honest offline mode + tests.
6. vision-service `/version` + pytest.
7. Docs: configuration, local storage, offline foundation, architecture decisions,
   testing guide, completion report.
8. Full validation: bun test, pytest, runChecks; native builds reported BLOCKED with
   exact reasons.

## Explicit non-goals for this stage

No recognition engines, no licensing backend, no billing, no cloud sync rewrites, no
new monorepo reshuffle (the existing `expo/` + `backend/` + `vision-service/` +
`proof-of-concept/` layout already separates the responsibilities the brief lists —
duplicating it as `apps/packages/` would be imitation, not architecture).
