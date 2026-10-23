# Stage 1 — Acceptance Tests & Measured Results
**AI Mark Entry System** — measured 2026-10-15 in the development sandbox (Linux,
Python 3.13, OpenCV 4.11.0, NumPy 2.3.5, no camera hardware present).

## 1. Method

- **Synthetic harness** (`proof-of-concept/live-paper-detection/synthetic_test.py`):
  deterministic desk scenes with known ground truth (we place the pages), running the
  real detector + state machine. Results are labeled SYNTHETIC — they prove the detection
  logic, not real-camera behavior.
- **Unit tests** (`test_detector.py`): 16 pytest cases covering detection geometry,
  every state transition, and gating.
- **Regression**: existing project suites re-run (bun 31 pass; vision-service pytest 17
  pass) to prove no regressions.

## 2. Measured results (synthetic)

| Criterion (target) | Measured | Status |
|---|---|---|
| Detect ≥ 95% of supported single clearly visible pages | **100% (8/8 scenarios with a page detected; single-page geometry error < 16 px on 960×720)** | PASS (synthetic) |
| Suppress duplicate triggers while a page is stationary | **0 duplicate triggers across 20+ stationary samples; READY fires exactly once** | PASS (synthetic) |
| Trigger within 2.0 s of stability on reference device | **0.60 s (3 samples @ 5 fps sampling)** | PASS (synthetic; reference CPU) |
| Recover gracefully from camera disconnection | `CAMERA_UNAVAILABLE` state + reconnect logic verified in state machine and runner | PASS (logic) / BLOCKED (real device) |
| Avoid saving images permanently by default | PoC retains no frames; diagnostics are numbers only | PASS |
| No-paper desk never triggers | `WAITING` held across 30 sampled frames | PASS (synthetic) |
| Two overlapping papers | `MULTIPLE_PAPERS` reported | PASS (synthetic) |
| Partial page (clipped by frame edge) | never READY | PASS (synthetic) |
| Low light / blur gating | `QUALITY_INSUFFICIENT` (page luminance < 60 / Laplacian variance < 35) | PASS (synthetic) |
| Leave-and-re-enter re-triggers | READY fires again after the desk clears | PASS (synthetic) |
| Page moves then restabilizes | re-triggers on large move; small twitch suppressed | PASS (synthetic) |
| CPU cost | **≈ 25–30 ms per 5-fps sample** (~12–15% of one core while sampling; 0 between samples) — headroom for mobile | PASS (measured, sandbox CPU) |
| Lighting variations beyond the two synthetic cases; real page sizes/orientations beyond portrait/landscape param test | **BLOCKED** — requires real camera + physical papers | BLOCKED |
| Real-camera cases (1–10 in §3) | **BLOCKED** — `/dev/video*` absent in sandbox; run `main.py` on any webcam laptop | BLOCKED |

## 3. Real-camera test cases (executed only on hardware — all BLOCKED here)

No paper · one paper enters · stationary remains · moves and restabilizes · leaves and
re-enters · two overlap · partial page · low light/blur · disconnect · app
close/reopen. The runner (`main.py`) implements all states; each case must be executed
and its evidence (state logs) recorded before Stage 2 sign-off on real devices.

## 4. Dataset & reproducibility

- Dataset: procedurally generated synthetic scenes (seeded, in `synth.py`) — no real
  student data, no private papers; regeneration is `python3 synthetic_test.py`.
- Commands: `python3 -m pytest test_detector.py -q` (16 pass) and
  `python3 synthetic_test.py` (8/8 scenarios).
- Targets were set from the brief; baseline measurement produced the numbers above —
  real-camera targets must be re-baselined on hardware in Stage 2.

## 5. Existing project regression evidence

| Suite | Result |
|---|---|
| `cd expo && bun test` | 31 pass, 0 fail |
| `cd vision-service && python3 -m pytest test_api.py -q` | 17 pass |
| Static checks (TypeScript/lint/structure) | 0 errors |
