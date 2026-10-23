# Stage 5 — Image Storage & Recovery
**AI Mark Entry System.**

## Records (existing data-model shapes, metadata only)
- `SessionRecord` — id, classId, assessment, paperType, startedAt/endedAt, status
  (`active | paused | completed | interrupted`).
- `CaptureRecord` — id, sessionId, seq (1-based), imageRef, fileName, capturedAt,
  status, optional detection metadata (area fraction, aspect, sharpness, luminance,
  normalized bounds) and `possibleDuplicate` flag, optional width/height.
- **Images never enter the KV store** (master §9). Metadata persists in the app's
  AES-256-encrypted store (`marks.scansessions.v1` / `marks.scancaptures.v1`); image
  bytes live in the platform ImageStore behind a 4-method interface.

## ImageStore adapters
| Platform | Implementation | Status |
|---|---|---|
| Web | Real IndexedDB store (`marks-scan-images`), blobs survive restarts | **implemented & used** |
| Native | Interface defined; Expo Go has no file-system module (installs refused) | **BLOCKED** — a dev build adds it without call-site changes |

## Write order & honest states (master §14)
Image bytes first → metadata second → status `saved` only after BOTH.
- Image write fails ⇒ **no record at all**; the screen shows "not saved" and the
  engine recovers (failure cooldown, next sheet unaffected).
- Metadata write fails after the image landed ⇒ no saved record is reported; the
  file is debris the next reconcile removes (crash-rollback: file-only state is not
  a capture).
- Native without an image adapter ⇒ record status `saveFailed` with reason — the
  session counts stay truthful.
- Filenames are generated (`cap-<session>-<seq>-<id>.jpg`, sanitized) — no teacher
  input ever reaches a path; no image paths appear in logs or user-facing text.

## Recovery (`runReconcile`, shared engine, runs at screen mount)
- Saved capture whose file vanished → `missingFile` (kept, flagged, never shown as
  saved).
- Image files no metadata references → removed and reported (orphans).
- `.tmp` leftovers → removed.
- Sessions left `active`/`paused` from a previous app run → `interrupted`; the
  teacher is offered **Resume or Close**, and ending never deletes images.
- Graceful exit pauses the open session (recoverable); removal of a capture deletes
  metadata first, then the file (file deletion is retried at the next reconcile).

## Privacy (master §13)
Frames are processed locally and transiently; only intended captures persist; no
upload exists anywhere in this stage; analysis frames live in memory for one sample;
thumbnails render from the local store only.
