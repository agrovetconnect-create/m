# Stage 5 Completion Report
**AI Mark Entry System · Live Camera, Automatic Paper Detection & Scanning Engine**
2026-10-17

## 1. Pre-flight
Stage 1–4 docs re-read; repository, entry points and the existing camera/CV
implementation inspected in source; green baselines verified by execution (bun 127,
runChecks 0, web export PASS). Gaps identified before coding (no in-app frame
analysis, no stability engine in TS, no capture persistence, no queue/review) and
listed in `STAGE_5_IMPLEMENTATION_PLAN.md` §0. Nothing from earlier stages was
rewritten; `STAGE_5_IMPLEMENTATION_PLAN.md` was created before implementation.

## 2. Features implemented (per master §3)
✅ Camera access with real permission states · ✅ live preview (web) ·
✅ continuous frame analysis (5 fps sampled) · ✅ candidate paper detection
(classical CV, measured) · ✅ stability determination (consecutive-sample IoU) ·
✅ automatic capture without a shutter press · ✅ same-sheet duplicate suppression ·
✅ local image persistence · ✅ session association · ✅ captured-paper queue ·
✅ inspect/retake/remove + duplicate flags · ✅ resume-to-next-paper ·
✅ recovery from camera errors and interrupted sessions.
**A successful capture means an image was captured and stored — nothing was
recognized** (no student, mark, or answer is extracted; scope fence §18 honored).

## 3. Files created / modified
**Created:** `expo/src/scanning/paper-detect.ts` (detector, fingerprints, RGBA
conversion), `expo/src/scanning/auto-capture.ts` (CaptureTracker state machine,
policy, single-flight), `expo/src/scanning/persist.ts` (ImageStore interface,
IndexedDB + memory adapters, runReconcile, ScanArchive), `expo/components/live-scanner.tsx`
(web platform adapter), `expo/app/live-scan.tsx` (Live Scanning screen),
`expo/tests/stage5-scan.test.ts` (35 tests), and 9 Stage 5 docs.
**Modified:** `expo/lib/store.tsx` (encrypted scan-session/capture slice +
reconcileScans action — additive only), `expo/components/live-scanner.tsx` additions
on the existing live-camera pattern, `expo/app/scan.tsx` (+1 entry button),
`expo/app/_layout.tsx` (+1 route), `expo/lib/i18n.tsx` (+34 keys ×5).

## 4. Camera APIs & CV algorithms used
Web: getUserMedia (facingMode, 1920×1080 ideal) → canvas sampling → Otsu threshold →
morphological close → connected components → geometric validation (area, aspect,
fill ratio, luminance-vs-desk, edge touch) → Laplacian-variance sharpness →
frame-to-frame IoU tracking. Native: expo-image-picker system camera (existing,
unchanged). Two robustness fixes over the PoC were found BY the new test suite
(desk-reference percentile; whole-frame rejection) — see PAPER_DETECTION.md.

## 5. Dependencies added and licensing
**None** (zero-dependency decision recorded in ARCHITECTURE_DECISIONS D1, §16
checklist applied: no paid APIs, no external services, no mandatory cloud).

## 6. Tests executed — exact results
| Check | Result |
|---|---|
| `cd expo && bun test` | **162 pass, 0 fail** (35 new Stage 5) |
| `runChecks(appPath: "expo")` | **0 errors** |
| `bunx expo export --platform web` | **succeeded** |
| Detector benchmark (bun, sandbox CPU) | detect ≈ 2.8 ms / 320×240 frame; RGBA→gray ≈ 1.7 ms / 640×480 |

## 7. Platforms actually verified
- **Web (build + type-checked code paths):** full pipeline implemented; the preview
  environment's browser camera provides the stream.
- **Physical paper on a real camera: NOT VERIFIED** — the sandbox has no camera
  hardware. All detection evidence is synthetic pixel buffers (clearly labeled);
  no physical-camera validation is claimed.
- **Android/iOS devices:** system-camera manual path + session persistence
  implemented; live analysis and image files BLOCKED (Expo Go refuses
  expo-camera/expo-file-system; installs were refused in earlier rounds).

## 8. False positives / negatives observed (synthetic suite)
Fixed during testing: (1) median-based contrast rule rejected real paper when a
close-up filled >50 % of the frame → replaced with a 25th-percentile desk reference;
(2) a whole-frame desk component passed aspect/fill checks → rejected by a
whole-frame rule; (3) hollow desk-border rectangles → fill-ratio rejection;
(4) shadowed and low-contrast sheets → rejected (no phantom detections). Residual
synthetic false positives: none in the 12-case suite. False negatives in real-world
lighting remain unverified (BLOCKED item).

## 9. Capture latency & performance
Detection-to-decision ≈ 2.8 ms per sample (measured); stability window ≈ 0.6 s
(3 samples @ 200 ms, by policy); capture latency is JPEG-encode + IndexedDB put
(web) — not separately benchmarked; no universal device-frame-rate promise is made.

## 10. Known defects & limitations
- Physical-camera behavior (real paper, real hands, real lighting) unverified —
  synthetic evidence only; expect threshold retuning on real devices.
- Native live scanning + image persistence BLOCKED (dev-build prerequisites).
- Fingerprint limitations as documented in STABILITY_AND_DUPLICATE_SUPPRESSION.md
  (identical-looking sheets in the same position cannot be told apart automatically;
  they are captured+flagged or re-armed by removal, never silently dropped).
- Detection outline is the candidate's bounding box, not corner-precise.

## 11. Manual testing still required
1. Web preview with a webcam: place/remove sheets; verify auto-capture, duplicate
   suppression, pause/resume, queue inspect/remove, session resume after reload.
2. Android device: system-camera capture into a session; end/reopen the session.
3. Dev build (once created): expo-camera frame pipeline + file-system image store
   through the existing engine interfaces.

## 12. Acceptance criteria (master §20) — verdicts
1 PARTIAL (web real; native manual path real; live native BLOCKED) ·
2 PARTIAL (web verified by build + code path; live preview not exercised with
physical hardware) · 3 PARTIAL (real frames analyzed on web; no hardware here) ·
4 PARTIAL (implemented + tested with synthetic frames; not shown on physical paper) ·
5 PASS (test: stationary sheet captured exactly once) · 6 PASS (test: removal
re-arms) · 7 PASS (test: records + restart recovery) · 8 PASS (queue renders real
saved captures) · 9 PASS (honest failure states, tested) · 10 PASS (restart recovery
tested; earlier data untouched — 162-test suite includes all prior regression) ·
11 PASS (stream/tracker stop on unmount/pause, tested) · 12 PASS (35 tests, results
documented) · 13 PASS (162 tests green) · 14 PASS (this section).

**Overall: Stage 5 = PARTIAL — the complete engine, persistence, and UI are
implemented and automated-tested; live-camera-on-hardware and native frame-pipeline
verification are BLOCKED by the sandbox.** Stage 6 (recognition) does not begin
until the owner reviews this report and approves.
