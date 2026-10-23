# Stage 5 — Paper Detection
**AI Mark Entry System.**

## Algorithm (simplest reliable, per master prompt §6)
A TypeScript port of the Stage 1 PoC's measured classical detector
(`proof-of-concept/live-paper-detection/detector.py`, 16/16 + 8/8 evidence), with two
robustness fixes learned from Stage 5's synthetic suite:

1. **Downscale** to ≤ 320 px wide (box-average from RGBA, Rec. 601 luma).
2. **3×3 box blur** (noise reduction).
3. **Otsu threshold** (256-bin histogram) → bright mask.
4. **Morphological close** (3×3 dilate+erode) to merge text gaps.
5. **Connected components** (4-connectivity, iterative flood fill — no recursion).
6. **Geometric validation** per component:
   - bbox area ≥ 12 % of frame (`minAreaFraction`);
   - aspect ratio within 0.42–2.4 (rejects slivers);
   - **fill ratio ≥ 0.5** (component ÷ bbox — rejects hollow desk-border frames);
   - **luminance ≥ 1.5 × desk reference** — the frame's 25th percentile. (Fix 1: the
     PoC used the frame *median*, which flips to paper brightness when a close-up
     fills >50 % of the frame and then rejects real paper — caught by Stage 5 tests.)
   - **bbox < 99.5 % of frame** (Fix 2: a component spanning the whole frame is the
     desk itself, not a scannable sheet).
   - `touchesEdge` flag when within 4 px of the frame edge → "partial page" guidance.
7. Output: candidates sorted by area with **measured** sharpness (Laplacian variance)
   and luminance. Empty result = "no paper" — the engine never invents a detection.

## What it is NOT
Document detection is not document recognition. A validated rectangle is a candidate
until capture; it carries no student, marks, or content meaning. There is no
quadrilateral corner-precision pass — the bounding box is the outline shown to the
teacher (perspective-distorted corners are inside the box, which is sufficient for
stability tracking and honest framing guidance).

## Measured performance (sandbox CPU, bun)
Detection on a 320×240 frame: **≈ 2.8 ms**; RGBA→gray conversion of a 640×480 frame:
**≈ 1.7 ms**. The 5-fps sample loop therefore spends ~2 % of a core — comfortable on
consumer devices, measured rather than promised. Real-device latency on low-end
phones remains to be verified (BLOCKED, see completion report).
