# Stage 5 — Stability & Duplicate Suppression
**AI Mark Entry System.**

## Stability policy (never time alone)
`CapturePolicy` (configurable, defaults shown): stability **frames = 3** consecutive
samples (200 ms apart ⇒ ≈0.6 s of stillness) whose bounds IoU ≥ **0.88** against the
previous sample; size/position changes beyond that reset the count. Quality gates
(sharpness ≥ 35, luminance ≥ 60, no edge-touch) must pass on the same samples.
Elapsed time never substitutes for geometric stability.

State machine: `searching → candidateDetected → waitingStability → captureReady →
capturing → saving → captured → cooldown → searching`, with `qualityInsufficient`,
`multiplePapers`, `cameraLost`, `paused`, `failed` branches. No captures fire while
initializing, paused, or mid-capture (single-flight `beginCapture()` — a second
concurrent request resolves false; duplicate async events cannot produce duplicate
saves).

## Re-arm policy (master §7)
After a capture the sheet stays suppressed while it remains in place. The engine
re-arms only when **`leaveFrames = 2` consecutive empty samples** show the sheet was
removed (a single-sample interruption — a hand passing over — does NOT re-arm), or
the teacher forces re-arm. Camera movement resets stability (IoU collapses).

## Duplicate suppression — three levels + retention rule
1. **Cooldown** 1200 ms after every capture attempt (success or failure).
2. **Geometry**: the captured sheet's bounds at IoU ≥ 0.90 with the current,
   still-stable candidate ⇒ suppressed (`captured` state), regardless of cooldown.
3. **Content fingerprint**: a 12×14 mean-luminance signature of the region; mean
   absolute cell diff ≤ 8 ⇒ same sheet (suppressed), ≥ 20 ⇒ genuinely different
   (capture), **in between ⇒ ambiguous — the image is captured, retained, and
   flagged `possibleDuplicate` for teacher review, never silently discarded.**

## Documented limitations (master §8)
- The fingerprint is layout-level: two different sheets with identical layout and
  faint handwriting may land in the ambiguous band (they are captured and flagged —
  never dropped) or, worst case, read as the same sheet while never removed from the
  frame. Removing the sheet always restores capture.
- Visually identical sheets in the *same* position cannot be distinguished by any
  noise-tolerant method; the policy's answer is the flag + teacher review, and the
  removal-based re-arm for genuinely new sheets.
