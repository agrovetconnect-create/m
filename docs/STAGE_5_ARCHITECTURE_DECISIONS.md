# Stage 5 — Architecture Decisions
**AI Mark Entry System.**

| # | Decision | Rationale & rejected alternatives |
|---|---|---|
| D1 | **No new dependencies.** Paper detection is a TypeScript port of the Stage 1 PoC's classical OpenCV pipeline (Otsu + components), rewritten in ~300 framework-free lines. | opencv-js ≈ 8 MB WASM for a 300-line algorithm; react-native-vision-camera is refused in Expo Go and untestable here; commercial licensing review unnecessary when nothing is added (master §16 checklist applied, recorded in IMPLEMENTATION_PLAN + this file). |
| D2 | **Pure engine + dumb platform adapters.** `paper-detect` (synchronous, GrayFrame in / regions out) and `auto-capture` (no timers; sample-timestamp driven) are fully decoupled from any camera API. | The Stage 3 boundary pattern; the exact engine the UI runs is what tests drive — mocks only at the frame layer. Browser APIs never leak into shared code (master §4). |
| D3 | **Detection frame = 320 px @ 5 fps; capture frame = up to 1600 px, on request only.** | Measured ≈2.8 ms/sample — real-time with ~2 % CPU; full-res frames are transient (JPEG-encode → release), satisfying §12's memory rules without promising a frame rate. |
| D4 | **Stability = consecutive geometric samples (IoU 0.88 × 3), never elapsed time.** | Master §7 explicitly forbids time-alone; the PoC's measured thresholds carried over. |
| D5 | **Three-layer duplicate suppression + retain-and-flag ambiguity.** | Cooldown/geometry/re-arrm handle camera noise; the 12×14 fingerprint band (≤8 same / ≥20 different / between → flagged) refuses exact-hash brittleness (master §8) and never silently discards. |
| D6 | **Metadata in the encrypted store; images in a platform ImageStore; reconcile-on-mount.** | Matches the approved architecture (AES-256 KV + versioned migration pattern); write-order (file→metadata) makes "saved" honest; reconcile implements the documented rollback for the non-transactional store. |
| D7 | **Native = honest system-camera manual path into the same session store.** | Expo Go refuses expo-camera/expo-file-system; faking a viewfinder or detection is forbidden by this project's rules. The engine is ready for the dev build unchanged. |
| D8 | **Recognition stays out.** Captured = image stored, nothing more. | Master §18 scope fence; `CaptureRecord.imageRef` is the future integration point for Stage 6 — no recognition code, fields, or UI exist here. |
| D9 | **Web-first verification.** | The web build is the platform this environment can actually run; it exercises the complete pipeline end-to-end (minus physical paper), so "supported" claims are limited to what was verified. |
