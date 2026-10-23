# Stage 5 — Testing Guide (live scanning engine)
**AI Mark Entry System.** Suite: `expo/tests/stage5-scan.test.ts` (35 tests), run
with `cd expo && bun test` (full suite: 162 pass). All frames are **synthetic pixel
buffers** (dark desk + bright shapes); real-camera validation is reported separately
and never claimed from these tests.

## A. Paper detection (synthetic scenes)
Centered A4-like sheet · rotated 7° · perspective trapezoid · too-small sheet
(rejected) · sheet partially outside frame (flagged `touchesEdge`) · empty desk ·
hollow desk-border rectangle (fill-ratio rejection) · shadowed paper (rejected) ·
low-contrast paper (rejected) · two separate papers (two candidates) · fingerprint
distance sanity · RGBA→gray downscale conversion.

## B. Stability & auto-capture
Moving sheet never fires (12 samples of drift) · stable sheet reaches capture-ready
after 3 policy samples · single-flight `beginCapture` · no capture while paused +
stability restarts after resume · camera loss ≠ "no paper" (`cameraLost` state) ·
quality gates with measurable reasons (blurry / too dark) · capture failure recovery.

## C. Duplicate suppression
Stationary sheet captured exactly once · 1-sample interruption does not re-arm ·
removal re-arms and the next placement captures · similar-but-new sheet after
removal is captured (never discarded) · ambiguous fingerprint → captured + flagged
`possibleDuplicate` · never-removed identical sheet suppressed by fingerprint.

## D. Persistence & recovery (MemoryStorageAdapter + MemoryImageStore + fault
injection)
Session/capture records with unique ids, filenames, seq · restart hydration ·
image-write failure → NO record (honest) · metadata-write failure after image save →
no saved record + orphan removed at reconcile · missing-file detection →
`missingFile` · interrupted-session marking (previous-run active → interrupted) ·
temp-file cleanup with valid captures intact · teacher removal deletes both, others
stay · corrupt JSON quarantines to empty state · pause→resume→end lifecycle keeps
images after end.

## E. UI / platform
Web: type-checked screen wiring (runChecks 0), web export build verified. Physical
device walkthroughs (real paper on a desk, real phones, native system-camera path,
background/foreground on device) are **manual items** — see the completion report;
no physical-camera validation is claimed from mocks.

## Detection performance measurement (reproduce)
```bash
cd expo && bun test tests/stage5-scan.test.ts   # 35 pass
# measured in-sandbox: detect ≈2.8 ms per 320×240 frame, ≈1.7 ms RGBA→gray (640×480)
```
