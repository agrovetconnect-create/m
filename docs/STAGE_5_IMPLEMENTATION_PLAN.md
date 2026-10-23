# Stage 5 Implementation Plan — Live Camera, Automatic Paper Detection & Scanning Engine
**AI Mark Entry System.** Written after the mandatory pre-flight inspection (§2 of the
master prompt), before any code.

## 0. Pre-flight findings (verified in source, not docs)
- Green baseline: bun 127 tests pass, runChecks 0 errors, web export builds.
- **Reusable, already-proven pieces:**
  - `expo/src/scanning/engine.ts` — typed ScanningEvent union + pure UI reducer
    (CameraPhase, ScanActivity incl. the READY one-shot pulse). This is the UI
    boundary; Stage 5 keeps it and drives it from the new engine.
  - `expo/src/domain/models.ts` — `ScanningSession` and `ScannedPage` types already
    exist (id, sessionId, seq, imageRef, capturedAt, status incl. "interrupted").
  - `proof-of-concept/live-paper-detection/detector.py` — Stage 1's measured classical
    detector (Otsu → contours → geometric checks → IoU stability tracker) with 16/16
    unit + 8/8 synthetic acceptance evidence.
  - `expo/components/live-camera.tsx` — real web getUserMedia viewfinder with canvas
    capture + torch; native keeps the system-camera path.
  - `expo/src/storage/adapter.ts` — StorageAdapter + migration runner + quarantine.
  - Encrypted store (`lib/store.tsx`) pattern for persisted slices.
- **Gaps (what Stage 5 must add):** no frame analysis loop in the app (detection only
  ran server-side/Python), no stability/auto-capture engine in TypeScript, no capture
  persistence (scan-archive derives "sessions" from entries only), no captured-paper
  queue/review for raw captures, no duplicate suppression, no scan-session lifecycle.
- **Environment constraints (honest):** expo-camera/expo-file-system cannot be
  installed in Expo Go (installs refused; not in package.json). Therefore: live frame
  analysis + on-device image files on native are BLOCKED; the web platform (the
  current preview target) supports the complete pipeline for real via getUserMedia +
  canvas + IndexedDB. Native keeps the system-camera manual path into the same
  session store, with live auto-capture marked PARTIAL/BLOCKED.

## 1. Architecture (interfaces first, platforms behind them)
```
                     ┌─────────────────────────────────────────────┐
 frames (web)        │  src/scanning/paper-detect.ts  (pure)       │
 GrayFrame ────────► │  Otsu → components → geometric validation   │
                     │  → PaperRegion[] (+ sharpness, luminance)   │
                     └──────────────┬──────────────────────────────┘
                                    ▼
                     ┌─────────────────────────────────────────────┐
                     │  src/scanning/auto-capture.ts  (pure)       │
                     │  CaptureTracker: stability + re-arm +       │
                     │  cooldown + fingerprint duplicate policy    │
                     └──────────────┬──────────────────────────────┘
                                    ▼ requests
                     ┌─────────────────────────────────────────────┐
 UI (live-scan.tsx)  │  screen loop: sample 5fps, downscale,       │
                     │  detect, decide, capture full-res, save     │
                     └───────┬───────────────────┬─────────────────┘
                             ▼                   ▼
              src/scanning/persist.ts    lib/store.tsx (new slice)
              sessions + capture records encrypted KV      │
                             ▼                   ▼
                     ImageStore (web: IndexedDB — real; native: BLOCKED)
```
- Platform adapters: **web** = real live stream + real analysis; **native** = system
  camera manual captures into the same session/persistence (no fake viewfinder, no
  fake auto-capture); desktop = deferred Tauri (D2), inherits the web build.
- The Stage 3 `scanStateMachine` stays the UI-state boundary; the new
  `CaptureTracker` is the capture-decision brain. They compose: tracker states map
  1:1 onto the ScanActivity vocabulary where they overlap.

## 2. Detection algorithm (ported from the measured PoC, same thresholds)
Downscale to ≤ 320px → grayscale → 3×3 box blur → Otsu threshold → 3×3 close →
connected components → per-component bounding rect with geometric validation:
area ≥ 12% of frame, aspect 0.42–2.4, luminance ≥ 1.5× frame median (kills desk
vignettes), edge-touch flag (partial paper). Sharpness = Laplacian variance on the
ROI; quality gate 35.0; underexposed floor 60. Multiple distinct components →
multiple-papers signal. This is the exact semantics already validated against the
PoC's synthetic harness; Stage 5 re-proves them in TypeScript with a synthetic
pixel-buffer suite.

## 3. Stability & auto-capture policy (configurable, not time-alone)
`CapturePolicy`: sample interval (200 ms), stability frames (3), stability IoU 0.88,
duplicate IoU 0.90, leave frames (2), cooldown ms after capture (1200), min area.
Fingerprint: 12×14 grayscale patch of the captured region; mean-abs-diff
≤ 6 → same sheet, ≥ 14 → different, between → AMBIGUOUS (retain + flag, never
discard). Re-arm only after `leave_frames` consecutive empty samples (sheet removed)
or a clearly different candidate. Captures never fire while paused/initializing/
already capturing; capture requests are single-flight (in-flight guard).

## 4. Persistence & recovery
- Sessions + capture records: new encrypted store slice (`marks.scansessions.v1`,
  `marks.scancaptures.v1`), following the store's hydrate/persist pattern.
- Images: `ImageStore` interface — web: IndexedDB (real blobs, survives restarts);
  native: interface defined, implementation BLOCKED (no file-system module in Expo
  Go; a dev build adds it without call-site changes).
- Write order: file first → metadata second → status "saved" only after both; db
  failure after file save → status "pendingRecovery" (file kept); missing file on
  reconcile → "missingFile", never silently dropped; temp/incomplete captures are
  cleaned at reconcile; removal deletes both metadata and file (file deletion is
  best-effort and retried on next reconcile).
- Session end never deletes images; interrupted sessions (app killed mid-session)
  are found on next start and offered for resume/close.

## 5. UI — Live Scanning screen (`/live-scan`)
Full-bleed live preview (web) with overlay outline from real detection bounds,
state banner (all 15 required states map onto real engine values), pause/resume,
end session, thumbnail strip of real saved captures, inspect modal (full image,
remove, duplicate-flag shown), manual capture fallback, camera switch (web
facingMode), real counts only. Native: honest "live auto-capture requires the
dev build" state + per-paper system camera into the same queue.
Entry point: a "Live capture" affordance on the existing scan screen (same
class/assessment params) — the recognition flow (scan.tsx) is untouched.
i18n ×5 for every new string.

## 6. Scope fences (master §18)
No handwriting/mark/ID recognition in this engine, no OMR, no auto matching to
students, no uploads — captured = image saved, nothing more. Interfaces leave
`imageRef` ready for Stage 6 recognition.

## 7. Test plan (bun, synthetic pixel buffers — clearly labeled synthetic)
Detector: A4-like, rotated, perspective, small, two objects, desk edge, shadow,
low contrast, occluded, none, multiple. Tracker: movement blocks, stability
reaches ready, brief loss no re-capture, camera move resets, pause blocks,
resume restores, failure recovers, cooldown, re-arm on removal, different sheet
captured, ambiguous flagged, single-flight. Persistence: unique ids/filenames,
session association, restart recovery, missing-file detection, failed writes,
db-failure-after-save, temp cleanup, safe delete, prior captures intact.

## 8. Execution order
Plan (this doc) → interfaces (paper-detect) → tracker → persistence → tests →
UI screen + store slice + i18n → runChecks/bun/web export → 9 Stage 5 docs →
STOP for owner approval.

## 9. Impact on earlier stages
None destructive. Stage 1–4 code is additive-only touched: `lib/store.tsx` gains a
new slice (new keys, existing shapes untouched); `scan.tsx` gains one button;
`scan-archive.tsx` gains capture-session cards. The blocked items from earlier
stages (client_events migration, native builds, SAF-on-device verification) are
unaffected and remain documented.
