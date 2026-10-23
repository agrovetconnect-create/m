# Stage 5 — Camera Architecture
**AI Mark Entry System.**

## Interface separation (master prompt §4)

```
CameraAdapter (per platform)          CaptureTracker (pure)         Persistence
────────────────────────────         ──────────────────────         ───────────
init / permissions                    observe(sample) → decision     ImageStore (put/get/
frame acquisition (5 fps sample)      stability, re-arm, cooldown    exists/remove/list)
detection frame downscale             duplicate suppression          CaptureRecord + SessionRecord
high-res grab on request              single-flight beginCapture     encrypted KV metadata
resource release                      pause/resume/forceRearm        reconcile on startup
```

- **Pure engine, dumb adapters.** All capture-decision logic lives in
  `src/scanning/auto-capture.ts` (pure, no timers — time enters via sample
  timestamps). Platform adapters only translate hardware into samples. Tests drive
  the exact reducer the screen runs.
- **Web adapter** (`components/live-scanner.tsx`): real getUserMedia stream rendered
  as a video element; an offscreen canvas samples at 200 ms (5 fps), downscales to a
  320-px-wide grayscale frame (box-averaged, Rec. 601 luma), and runs
  `detectPaper`. A second canvas produces the 1600-px JPEG **only** at the instant a
  capture is requested — full-resolution frames are never retained.
- **Native adapter**: honest fallback. Expo Go refuses the camera module (documented
  since the first round), so there is no frame pipeline to analyze. The screen shows
  the real state and offers per-sheet system-camera capture (expo-image-picker,
  real permission flow) into the same session/persistence. `PARTIAL`, never faked.
- **Resource management (§12):** the stream stops on unmount and on status loss;
  analysis skips entirely while paused; the sample interval caps work at ~5 fps;
  bounded queues are unnecessary by design (each sample is stateless — no frame
  backlog exists); camera switch restarts the stream with a new facingMode.

## UI states — every value is real

Camera: starting / live / denied / unavailable. Engine: searching, paper detected,
waiting stability, capture-ready, capturing, saving, captured, cooldown, failed,
quality (partial/too-dark/blurry reasons), multiple papers, camera lost, paused.
The banner text maps 1:1 onto these engine values; no fabricated progress or
confidence is ever shown.
