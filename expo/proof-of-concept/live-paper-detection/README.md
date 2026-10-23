# Live Paper-Detection Proof of Concept (Stage 1)

Minimal, runnable PoC for **continuous live paper detection**: page presence, stability,
quality gating, duplicate-trigger suppression, and the states the scanning workspace will
show. It deliberately does **not** recognize marks — recognition is Stage 2 (see
`docs/STAGE_1_RECOGNITION_PLAN.md`).

## Approach

Classical OpenCV only (grayscale → Otsu → contour geometry → Laplacian-variance
sharpness → mean-luminance exposure → bounds-IoU stability), matching the thresholds
already validated in `vision-service/`. Chosen over an ML model because it is cheap
(~25–30 ms per sample at 5 fps sampling), license-safe (Apache-2.0), and adequate for the
detection job — re-evaluate only with Stage 2 measurements.

## Setup & run

```bash
cd proof-of-concept/live-paper-detection
pip install opencv-python numpy pytest   # or: apt install python3-opencv

python3 -m pytest test_detector.py -q    # 16 unit tests (headless)
python3 synthetic_test.py                # 8/8 acceptance scenarios + measurements
python3 main.py --camera 0               # real webcam runner (needs camera hardware)
```

`main.py` keys: **Q** quit · **R** process the current page again. It reconnects
automatically after a camera disconnect and prints state-transition diagnostics on exit.

## Files

- `detector.py` — `detect_paper()` + `PaperTracker` state machine + `Diagnostics`
- `synth.py` — synthetic desk/page frame generator (ground-truth testing, no camera)
- `main.py` — real-camera runner with overlay and reconnect
- `test_detector.py`, `synthetic_test.py` — tests and the measurement harness

## Limitations (honest)

- No camera in the dev sandbox → all real-camera acceptance cases are BLOCKED until run
  on hardware; synthetic results do not substitute for them.
- Detection assumes a page brighter than its background (contrast ratio ≥ 1.5 vs frame
  median) — very bright desks/high-key scenes may need per-device threshold tuning.
- Duplicate suppression is placement-based (bounds IoU); visually identical *different*
  pages swapped in the same spot are treated as the same page until the teacher resets
  (R) or the page leaves the frame — content-level dedup (hashing) is Stage 2.
- Hand-drawn desks, hands over the page, and curved (folded) paper are untested here.
