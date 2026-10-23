# Stage 1 Completion Report
**AI Mark Entry System** · 2026-10-15

## 1. What existed before this work
A working **React Native/Expo 54 (TypeScript)** teacher mark book (`expo/`): offline-first
AES-256-CTR + HMAC-encrypted records, Supabase auth/RLS sync with signed records,
conflict resolution, 5-language i18n with RTL, web live-camera viewfinder, engine-backed
scan flow with confidence gating (0.75 floor) — plus a **Python FastAPI + OpenCV**
vision service (`vision-service/`, OCR-ready when deployed with Tesseract) with
rate limiting, body caps, OCR timeout, and concurrency control. All suites were green
before Stage 1 changes: bun 31 pass, vision-service pytest 17 pass, static checks 0 errors.

## 2. What changed in Stage 1
Added the complete Stage 1 documentation set and a standalone live paper-detection PoC.
**No existing application or service code was modified.**

## 3. Files created / modified
Created:
- `docs/STAGE_1_PRODUCT_SPECIFICATION.md`, `STAGE_1_ARCHITECTURE.md`, `STAGE_1_DATA_MODEL.md`,
  `STAGE_1_LICENSING.md`, `STAGE_1_SECURITY_AND_PRIVACY.md`, `STAGE_1_RECOGNITION_PLAN.md`,
  `STAGE_1_ACCEPTANCE_TESTS.md`, `STAGE_1_COMPLETION_REPORT.md` (this file)
- `proof-of-concept/live-paper-detection/`: `detector.py`, `synth.py`, `main.py`,
  `test_detector.py`, `synthetic_test.py`, `README.md`

Modified: none (existing code untouched; git working tree preserved — only Rork history
files show pre-existing modifications).

## 4. Architecture decisions & reasons
1. **Adapt, don't replace** — the Expo app + FastAPI vision-service already satisfy the
   product's core constraints (offline-first, local processing, optional cloud); Stage 1
   documents them as the architecture's mobile/web/service layers rather than starting over.
2. **Classical CV for detection** (Otsu/contours/IoU, ~25–30 ms per sample) — cheap,
   deterministic, license-safe; ML is deferred to recognition where it's actually needed.
3. **Shared strict frame contract** between engines (`vision-schema.ts`) so recognition
   engines stay swappable.
4. **Desktop deferred** — web/PWA covers pilots; Tauri preferred over Electron later,
   with a license review at packaging time.
5. **Licensing by signed offline activation records** (asymmetric), never a client boolean.

## 5. Commands executed
`git log`/`git status` (Step Zero), `python3 -c "import cv2…"`, `ls /dev/video*`,
`python3 -m pytest test_detector.py -q`, `python3 synthetic_test.py`,
`cd expo && bun test`, `cd vision-service && python3 -m pytest test_api.py -q`,
static checks (runChecks).

## 6. Tests actually run & results
| Suite | Result |
|---|---|
| PoC unit tests (`test_detector.py`) | **16 pass, 0 fail** |
| PoC synthetic acceptance harness | **8/8 scenarios pass** |
| Expo `bun test` | 31 pass, 0 fail |
| vision-service pytest | 17 pass |
| Static checks (TS/lint/structure) | 0 errors |

Two real detector defects were found and fixed during this testing: an empty desk
produced a phantom region (fixed with a contrast-ratio gate vs frame median), and a
dataclass mutable-default crash (fixed with `field(default_factory)`).

## 7. Camera testing evidence / limitations
**No camera hardware exists in this environment** (`/dev/video*` absent) → every
real-camera acceptance case is **BLOCKED**, honestly labeled in
`STAGE_1_ACCEPTANCE_TESTS.md`. Evidence provided is synthetic-only (seeded ground-truth
scenes through the real detector/state machine) plus a webcam runner (`main.py`) ready
for hardware. No claims of real-device results are made.

## 8. Dependencies & licenses reviewed
OpenCV (Apache-2.0), NumPy (BSD-3), FastAPI/Uvicorn (BSD-3/MIT), Tesseract (Apache-2.0),
pytest (MIT) — commercial-use safe. Expo/React Native stack in use is MIT/Apache-2.0.
Stage 2 candidates verified license-safe: PaddleOCR (Apache-2.0), ONNX Runtime (MIT),
TrOCR (MIT). No new paid dependencies introduced; the optional cloud-AI engine is an
existing labeled alternative, not a dependency of the core workflow.

## 9. Known defects & unresolved risks
- Real-camera behavior unverified (BLOCKED) — thresholds may need per-device tuning.
- Duplicate suppression is placement-based, not content-based (documented limitation).
- Encryption keys are app-storage-backed until a dev build (Keychain/Keystore).
- Real billing and the store listing are blocked on the owner's store accounts.
- `client_events` cloud table migration pending on a Supabase-side API outage (client
  queues locally; analytics are functional).

## 10. Stage 1 acceptance status
- Product specification, architecture, data model, licensing model, security/privacy
  requirements, recognition plan: **PASS** (documented, grounded in the existing repo)
- Live paper-detection PoC: **PASS** (16/16 unit + 8/8 synthetic scenarios, measured)
- Reproducible setup/run guide: **PASS** (PoC README)
- Real-camera verification: **BLOCKED** (no hardware in environment)
- Automated tests for implemented logic: **PASS**
- Overall: **Stage 1 PARTIAL** — complete except real-camera evidence, which requires
  hardware this environment does not have.

## 11. Exact prerequisites for Stage 2
1. A webcam-equipped laptop (or Android/iOS dev build) to execute the 10 real-camera
   acceptance cases and re-baseline thresholds.
2. Dev-build tooling decision (EAS/local) to unlock Keychain-backed keys and an in-app
   live viewfinder on mobile.
3. Store accounts (Google Play / Apple Developer) for licensing and billing integration.
4. Authorization framework for collecting labeled sample papers (no real student data
   without consent) for recognition-model benchmarking.
5. Approval of this Stage 1 report by the owner.

**Stage 1 stops here. Stage 2 does not begin until the owner reviews and approves.**
