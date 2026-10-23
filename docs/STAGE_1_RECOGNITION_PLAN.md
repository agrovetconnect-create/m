# Stage 1 — Recognition Research Plan
**AI Mark Entry System** — Stage 2 pipelines specified here; nothing in this document is
implemented beyond the label-anchored OCR already validated in `vision-service/`.

## 1. Ordinary examination papers (teacher-awarded marks)

| Step | Approach | Notes |
|---|---|---|
| 1. Page extraction | PoC contour/Otsu detector output feeds perspective correction (4-point homography) | detection already proven |
| 2. Orientation correction | Text-direction via OSD (Tesseract) + EXIF; portrait/landscape both supported | cheap, deterministic |
| 3. Layout understanding | Per-class **paper templates** (zone maps: ID zone, name zone, question margins, total box) — configured once per layout, not universal AI | honest answer to "no universal layout" |
| 4. Student-ID recognition | Tesseract (printed) → small CRNN/TrOCR-style handwriting model for handwritten IDs, ONNX Runtime | confidence per character |
| 5. Awarded-mark localization | Template zones + connected components near question numbers; total-box detection | label-anchored (already validated) |
| 6. Mark interpretation | Score-annotation parsing (`34/50`), handwritten digit recognition (small ONNX model), strike-through/correction detection → flag | corrections never auto-resolved |
| 7. Confidence estimation | Per-field OCR confidence × geometric sanity (in-range vs max_mark) → combined score; **floor 0.75 → manual** | existing rule |
| 8. Student matching | Exact reg-no match → fuzzy name match (existing roster matching) → ambiguous = teacher decision | implemented |
| 9. Human verification | Verification UI; suggestions ≠ approved records | implemented |

**Open-source model candidates** (licenses verified Apache-2.0/MIT unless noted):
Tesseract 5 (Apache-2.0, now), PaddleOCR (Apache-2.0; PP-OCRv4 detection+recognition, good
handwriting tolerance, ONNX-exportable community builds), TrOCR / TrOCR-base-handwritten
(MIT, transformer-based, heavier), EasyOCR (Apache-2.0, PyTorch runtime heavier), and for
digits a small CNN trained on MNIST-family data (MIT-compatible datasets). Training-data
requirement for handwritten ID/marks: a few thousand labeled samples from **authorized**
papers — synthetic augmentation first; no real student records without written consent.

## 2. Pipeline for OMR sheets (separate engine)

1. **Sheet-template selection** — fiducial markers/timing marks identify the template;
   unknown template → ask, never guess.
2. **Alignment & registration** — fiducial-based affine correction (OpenCV).
3. **Bubble localization** — template-driven grid positions, not free detection.
4. **Response detection** — fill ratio per bubble with adaptive thresholds;
   states: `filled`, `blank`, `multiple` (>1 filled in single-select), `ambiguous`
   (partial fill in the uncertainty band) — ambiguous/multiple are **flagged for the
   teacher, never auto-scored**.
5. **Candidate-ID extraction** — ID bubbles + optional OCR of handwritten ID.
6. **Answer-key scoring** — only against an explicitly configured key; multi-select
   scored per configured policy; unkeyed questions excluded.
7. **Confidence & validation** — per-response fill-margin confidence; cross-checks
   (ID vs roster; blank-rate sanity).
8. **Human verification** — same approval rule as ordinary papers.

## 3. Constraints honored

No large-model training or fine-tuning in Stage 1; no real student data without
authorization; every candidate model benches against the same labeled test set before
replacement decisions; the cloud-AI engine remains an optional, clearly labeled
alternative — the on-device/self-hosted path is the product's core.
