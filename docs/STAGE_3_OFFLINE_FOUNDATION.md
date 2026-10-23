# Stage 3 — Offline-First Foundation
**AI Mark Entry System.**

## Status: implemented and working (carried from approved rounds, re-verified this stage)

Offline-first is not a TODO in this product — it is the architecture the app already
ships: entries are written to the encrypted local store first, cloud sync is additive
and optional.

## Local capability matrix (real behavior)

| Capability | Works offline | Notes |
|---|---|---|
| Mark entry (manual) | ✅ | local store, signed records |
| Review, correction, approval | ✅ | version history local |
| Classes / students / assessments | ✅ | local rosters |
| Excel/CSV import & export | ✅ | device-local files; source never overwritten |
| Live scanning (web) | ✅ capture; recognition needs the configured engine | viewfinder itself is local |
| Cloud sync | ❌ by definition | auto-resumes on reconnect (NetInfo push + 45 s backup interval); queue counter visible |
| Cloud-AI recognition | ❌ | routes to manual entry with the reason named — never a fake result |
| CV-OCR recognition | only if the teacher's own server is reachable | distinct not-configured / unreachable states |

## Honest connectivity states

- The online badge reflects the **real radio state** (NetInfo), never an assumption —
  `null` (unknown) renders as unknown, not "online".
- A failed sync never discards local changes: records stay queued (`synced: false`),
  surfaced by the unsynced counter; conflicts go to the resolve screen, never silent
  overwrite (server-signature tracking).
- No local feature depends on a cloud endpoint: with all optional env vars absent, the
  app boots in `offline-first` mode and everything in the matrix's ✅ rows works.

## Scanning state management offline

The Stage 3 scanning boundary (`src/scanning/engine.ts`) is pure and local: detection
states, duplicate suppression, quality gates, disconnect/pause/resume — all function
without network. Recognition is the only network-touching step, and its absence is an
explicit, honest state (engine unreachable / offline → manual entry).

## Future work (documented, not built)

Full conflict-resolution UX beyond the existing resolve screen, backup/restore flows,
and account synchronization across devices remain sync-stage work per the Stage 1
architecture. Exported files are device-local until the desktop packaging stage adds
system save dialogs.
