# Stage 2 — Screen Specifications
**AI Mark Entry System** — purpose, layout, actions, and states for every required
screen. Each spec names the **current implementation status** honestly: many flows
already exist and work from earlier stages; Stage 2 specifies their final form and
applies the design system. Screens marked *spec only* are defined now for a later stage
— they are not stubbed with fake buttons.

## Navigation shell (implemented)

Existing, verified 3-tab mobile shell + stack: **Home · Marksheets · Reports**, with
Profile/Settings reached from the Home header (per an explicit earlier user decision).
Mapping to the proposed 7-section IA — merged where it reduces complexity without
removing function:

| Proposed section | App location | Rationale |
|---|---|---|
| Home | Home tab | overview + primary action |
| Mark Entry | Home primary action → Scan flow | a workflow, not a destination — no tab |
| Registers + Assessments + Classes & Students | Marksheets tab (class setup, assessment/marksheet creation, roster) | one register-centric section avoids three thin tabs |
| History & Exports | Reports tab + scan archive | sessions, approved results, exports |
| Settings | Settings screen from Profile | preferences, camera, engine, privacy, account |

No destination is reachable by two different paths. Web/desktop-wide layout (sidebar
replacing the tab bar ≥ `desktop` breakpoint) is specified for Stage 3's web shell; the
mobile tab bar is never squeezed into a sidebar or vice versa.

## 1. Home / Overview — *implemented, themed*
**Purpose:** launch point; three honest signals + primary action.
**Layout:** header (greeting, profile icon) → primary "Start scanning" action → recent
session summary (real last session from the archive) → pending-review count (real
unsynced/unreviewed entries) → last export (real record, or nothing).
**States:** first run → onboarding hand-off, no fabricated stats; offline → offline
badge (real NetInfo state); signed out → sign-in prompt.
**Rule:** no dashboard cards duplicating tab destinations; no invented metrics.

## 2. Mark Entry setup — *implemented* (class-setup → new-marksheet → scan config)
**Purpose:** configure a session before the camera opens.
**Layout (steps):** ① class (existing or standalone) ② subject + assessment name +
max marks ③ paper type: **ordinary marked papers** vs **OMR sheets** — segmented
choice, two labeled cards, never blended ④ register source: existing Excel import,
generated register, or current roster ⑤ review summary → Start.
**States:** required vs optional labeled; review summary always shown before start;
OMR without an answer key → key step (spec §6.8) or "score later" explicit choice.

## 3. Live scanning workspace — *implemented* (scan + live viewfinder + HUD)
**Purpose:** the instrument. Camera preview dominates; everything else is a quiet
peripheral.
**Layout:** full-bleed live preview (web) / system camera (native — platform honest) →
top HUD: camera + detection state (from the real PoC state machine / engine), read
quality (clear/blurry/dark), confidence, latency → paper-bounds overlay → bottom:
start/pause/stop, chain toggle, light toggle, papers-processed counter.
**States:** permission denied → recovery screen (Settings link + retry); engine
unreachable → genuine "recognition unavailable — manual entry" (never fake scanning);
offline indicator visible; duplicate → warning + retry; unsupported paper → warning.
**Rule:** recognition finishing never auto-approves; results route to review.

## 4. Recognition results & review — *implemented* (sheet-review / student-match / resolve-conflict)
**Purpose:** human-in-the-loop gate. Every read is a suggestion until approved.
**Layout:** result card per paper: source-page reference (captured image), student ID +
name (with roster match), mark vs max, `ConfidenceIndicator`, `StatusBadge`
(extracted/needsReview/corrected/approved/rejected/exported), inline edit fields,
approve/reject/retry actions.
**States:** ambiguous (low confidence or no roster match) → needs-review list, never a
quiet background queue; duplicates flagged; batch approve only for ≥ floor confidence
and matched students; ambiguous ones stay individual.
**Data-preservation rule:** review work is saved locally immediately; no timeout discards it.

## 5. Register import & mapping — *implemented core* (sheets.ts + xlsx tests)
**Flow:** pick .xlsx/.csv → preview parsed sheet → choose sheet/header row → map
columns (ID, name, assessment, mark) → validate (missing students, duplicates, out-of-
range marks listed with row numbers) → resolve conflicts → confirm → **output is a new
copy; the source file is never overwritten**.
**States:** parse failure with reason; unmapped required column blocks confirm;
unsupported workbook structures are rejected with an explanation, not guessed.

## 6. Generated register setup — *implemented* (new-marksheet flow)
Class/group, student list, subject, assessment name, max marks, optional grading rule,
output columns → template preview → generate. Preview shows the exact columns that
will be produced.

## 7. Classes & students — *implemented* (class-detail, roster import)
Roster import (xlsx/csv/manual), ID + name + membership, search (`SearchField`),
duplicate detection on import with row-level resolution, manual correction. No school-
administration features (no timetables, fees, HR).

## 8. Assessments — *implemented within Marksheets*
Subject, assessment name, type, max marks, OMR answer-key association (when the
assessment is OMR), status; editing an assessment that already has approved marks →
`ConfirmDialog` + version history preserved.

## 9. History & exports — *implemented* (reports, scan-archive)
Sessions with date, paper count, approved/pending counts, export status, errors with
recovery actions, output location. **Never fabricated** — the list renders real session
records; empty archive shows `EmptyState`.

## 10. Settings — *implemented*
Sections: General (language, theme), Camera & scanning (permission, low-MP warning,
chain mode), Recognition (engine picker ai/cv, CV service account + test connection),
Offline data (retention), Backup & sync (auto-sync, sync now, conflict resolution),
Account, Privacy (policy, data deletion — real), Diagnostics (version). Controls without
behavior are disabled with an explanation or labeled "not yet implemented" — no dead
buttons. Licensing section appears when the licensing backend ships (Stage 3+).
