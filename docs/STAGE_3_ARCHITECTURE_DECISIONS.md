# Stage 3 — Architecture Decisions
**AI Mark Entry System.** Each decision: what, why, and what it rules out.

## D1 — One shared Expo app for Android, iOS, and web
**Decision:** the existing React Native/Expo (TypeScript, expo-router) app is the
product for all three targets; react-native-web renders it in browsers (already
configured in `app.json`).
**Why:** the app, design system, domain logic, and tests are shared by construction;
four implementations of the same business rules are impossible this way.
**Ruled out:** separate web (React SPA) and mobile codebases — duplicates every rule;
native Kotlin/Swift rewrites — discard approved, tested work.

## D2 — Windows desktop = packaging, not a parallel app (deferred)
**Decision:** at packaging time, the web build is wrapped with Tauri (Stage 1 decision
reaffirmed). No desktop scaffold exists in Stage 3.
**Why:** a Tauri project could not be built or verified in this Linux sandbox, and an
unverifiable desktop target would be a claim, not a foundation. The platform-specific
seams (file dialogs, camera) are typed adapters (D4, D5), so the wrapper slots in
without app rewrites.
**Ruled out:** Electron (heavier, bundles a second JS runtime); a native desktop
framework (third implementation of the product).

## D3 — Storage: approved encrypted store as the current adapter, formalized seam
**Decision:** `StorageAdapter` (get/set/remove) in `expo/src/storage/adapter.ts` is the
persistence contract. The live implementation remains the Stage 1 AES-256-CTR + HMAC
AsyncStorage layer (with its second-copy backup). A versioned migration runner
(`runMigrations`) and corrupt-payload recovery (`safelyParse` with quarantine) are now
tested infrastructure. SQLite (expo-sqlite) becomes the engine behind the same
interface in a dev build — documented as the upgrade path, not built now (native
module installs are refused in this environment).
**Why:** honest scope — no unverified SQLite/SQLCipher claims; schema evolution becomes
testable now.
**Ruled out:** rewriting the working store around an untestable SQLite layer; claiming
"encrypted local database" without verification.

## D4 — Camera/scanning: typed boundary, real states only
**Decision:** `expo/src/scanning/engine.ts` defines `ScanningEvent` (15 event/state
kinds per the brief) and a pure reducer to `ScanUiState`. The two existing platform
implementations map onto it: web = getUserMedia live viewfinder; Android/iOS = system
camera via the image picker (native module installs refused — documented, unchanged).
The Stage 1 PoC's semantics (READY one-shot pulse, duplicate suppression, quality
gates, disconnect recovery) are the app-level contract.
**Why:** the UI can only ever reflect real engine states; adding a desktop adapter
later is an implementation detail of the same interface.
**Ruled out:** a web camera library assumed to work in RN/desktop; any "simulated
scanning" UI.

## D5 — Files: adapter boundary + source-never-overwritten rule
**Decision:** `FileAdapter` (pickImport/readText/writeExportCopy) plus pure rules
(`sniffFormat`, `assertSafeExportTarget`, `uniqueName`) in `expo/src/files/adapter.ts`.
The spreadsheet engine itself stays Stage 4; the boundary is tested now.
**Why:** the never-overwrite rule and format rejection are enforceable before any
workbook parsing exists; web/native/desktop pickers differ only behind the interface.

## D6 — Domain logic is framework-free
**Decision:** `expo/src/domain/` (models, mark validation) imports no react-native —
recognizable engines, storage adapters, and bun tests share it. Mark validation is
separate from recognition (Stage 1 plan §1.7) and never coerces malformed input.
**Ruled out:** validation embedded in screens or engine clients.

## D7 — Configuration: public client config, validated at startup
**Decision:** `readClientConfig` validates `EXPO_PUBLIC_*` at startup; contradictory
config is a hard error, absent optional services select `offline-first` mode. No
server secrets in the client (anon key is public by design). `.env.example` documents
the variables.
**Ruled out:** service-role keys or DB admin credentials in client bundles; required
cloud endpoints for local functionality.

## D8 — Backend: the existing FastAPI vision-service, extended minimally
**Decision:** no new backend. The vision-service (health, auth, rate limiting, tests)
gains `/version` (service/version/ocr_available — no secrets). It remains optional:
local scanning and entry never require it.
**Ruled out:** building an unused "foundation" backend; paid infrastructure.

## D9 — Repository layout: keep, don't imitate a monorepo
**Decision:** the existing layout already separates the brief's concerns — `expo/`
(app + `src/` domain/design-system/storage/files/config boundaries), `backend/`
(Supabase), `vision-service/`, `proof-of-concept/`, `docs/`, `expo/tests/`. Renaming
into `apps/packages/` would churn every approved path for zero behavior change.
**Ruled out:** cosmetic monorepo restructuring.
