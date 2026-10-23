# Stage 3 — Testing Guide
**AI Mark Entry System.**

## Test layout

| Suite | Where | Runner | Needs |
|---|---|---|---|
| Domain, scanning, storage, files, config | `expo/tests/foundation.test.ts` | `bun test` | nothing (pure TS) |
| Crypto (HMAC RFC 4231, AES roundtrip), i18n parity, JWT, roster, sheets, xlsx | `expo/tests/*.test.ts` | `bun test` | `tests/preload.ts` shims |
| PoC detector unit tests | `proof-of-concept/live-paper-detection/test_detector.py` | pytest | OpenCV |
| PoC synthetic acceptance harness | `.../synthetic_test.py` | python3 | OpenCV |
| vision-service API (auth, ledger, vision, limits, version) | `vision-service/test_api.py` | pytest | `pip install fastapi uvicorn httpx` |
| Static checks (tsc, lint, project structure) | — | `runChecks(appPath: "expo")` | — |

## Running

```bash
cd expo && bun test                     # 66 tests
cd proof-of-concept/live-paper-detection && python3 -m pytest test_detector.py -q
cd vision-service && python3 -m pytest test_api.py -q
```

## What Stage 3 tests cover (evidence)

- **Domain:** valid/invalid marks, max-mark boundaries, decimal precision, negative
  values, non-numeric rejection (no silent coercion), duplicate (student, assessment)
  keys.
- **Scanning integration:** all state transitions with **mocked camera events only** —
  idle (never auto-start) → ready → paperReady (one-shot capturable), duplicate
  suppression as explicit alert, quality/multi-paper alerts, disconnect → paused with
  preserved counts, stop → full resource release.
- **Local persistence:** migration ordering, version recording, failed-migration
  rollback (store stays at previous version, retryable), migration-gap refusal, corrupt
  version marker, corrupt-payload quarantine + fallback.
- **Files:** format sniffing with honest rejections, never-overwrite-source rule,
  duplicate-name suffixing.
- **Configuration:** offline-first fallback, hard errors for contradictory config,
  malformed-URL rejection.

## Real-hardware tests (kept separate, currently BLOCKED)

Real-camera PoC cases, VoiceOver/TalkBack walkthroughs, and on-device builds (Android
APK, iOS) require hardware/toolchain this sandbox lacks — see the completion report's
BLOCKED list. No mocked test pretends to cover them.

## Adding tests

Pure logic goes in `expo/src/**` and is tested directly under `expo/tests/`. RN-runtime
code needs a shim in `tests/preload.ts` or must stay behind a pure seam (the Stage 3
adapters exist precisely so this stays easy). vision-service tests are numbered
sequentially (`test_NN_...`) — keep that ordering.
