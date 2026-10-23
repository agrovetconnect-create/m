# Stage 1 — Product Requirements Specification
**AI Mark Entry System** · Version 1.0 · Stage 1 (specification + proof of concept only)

## 0. Summary

An independent, teacher-focused, cross-platform system that transfers examination marks
from paper into digital marks registers. The teacher scans marked papers with a live
camera; the system detects the page, recognizes teacher-awarded marks and student
identifiers, presents every read for **human verification**, and exports a completed
register. It complements — never replaces — existing school marks-management systems and
requires **no government partnership, vendor integration, or external operator** for any
core function.

**Stage 1 scope** (this stage): product spec, architecture, data model, licensing model,
security/privacy requirements, a live paper-detection proof of concept, a recognition
research plan, and measured acceptance evidence. **Stage 1 does not deliver** mark
recognition, OMR scoring, register import/export, or the production app.

## 0.1 Current repository baseline (Step Zero inspection, 2026-10-15)

- Existing application: **React Native + Expo 54 (TypeScript)** teacher mark book with
  offline-first encrypted storage, Supabase sync, signed records, 5-language i18n with
  RTL — all existing tests green (bun 31, pytest 17) before this stage's changes.
- Existing CV service: **Python FastAPI + OpenCV** (`vision-service/`) with an
  Otsu/Laplacian quality pipeline (sharpness floor 35.0, underexposure floor 60.0,
  paper ≥ 12% of frame) — the PoC reuses these validated thresholds.
- Environment: Linux sandbox, Python 3.13, OpenCV 4.11.0, NumPy 2.3.5, bun, Node.
- **No camera hardware** in the sandbox (`/dev/video*` absent) → all real-camera
  verification is **BLOCKED** and labeled as such; a synthetic-frame harness provides
  the measurable evidence instead.
- Proposed change list (all applied): new `docs/` set, new
  `proof-of-concept/live-paper-detection/` module, **no changes to existing app code**.

## 1. Users

| User | Description | Key needs |
|---|---|---|
| **Individual teacher/lecturer** | Buys and manages their own license | Independent setup, class config, scanning, export |
| **Licensed teacher** (school-owned license) | Uses a seat assigned by their institution | Same as above, no purchase friction |
| **Institutional license administrator** | Manages a license bundle, assigns/revokes seats | Seat dashboard, usage overview (no access to marks data) |
| **Application owner / license administrator** | Runs the licensing service | Issuing, renewing, revoking licenses |

There is deliberately **no government role** and no mandatory school administrator for
individual teachers.

## 2. Ordinary examination papers (teacher-marked)

Papers already marked by the teacher, containing: printed or handwritten student names,
registration/exam IDs, teacher-awarded numeric marks (beside questions and/or totals),
denominators, and handwritten annotations/corrections.

**Distinguishing awarded marks from everything else** (design commitments, validated
incrementally from Stage 2 onward):

1. **Label anchoring** — marks are read relative to annotations ("Score:", total boxes,
   per-question margins), never as free-floating numbers. The existing CV engine already
   implements label-anchored reading (`Name:`, `REG-`, `Score:` patterns).
2. **Zone logic** — per-question marks live in the margin zone adjacent to question
   numbers; page numbers, dates, and headers live in fixed zones that are excluded.
3. **Denominator pairing** — an awarded mark is preferentially read as a
   `mark / denominator` pair ("34/50"); a bare number with no pairing context is
   lower-confidence.
4. **Corrections** — strike-throughs and rewrites are flagged for human review, never
   auto-resolved; a correction's latest legible value is a *suggestion only*.
5. **Confidence floor** — any read below the configured floor (current system: 0.75) is
   routed to manual entry. **A recognized mark is a suggestion until the teacher approves it.**

**Initial supported-paper scope (Stage 1 definition):** single-page sheets, portrait or
landscape, printed or neat handwriting, one marks-total annotation per page, student ID
and name printed or handwritten in a consistent location per class template. Non-English
scripts and dense multi-column layouts are **out of scope until a layout-configuration
mechanism exists** (Stage 3+): new layouts will be supported by per-class paper templates
(zone maps), not by universal recognition.

## 3. Standardized OMR answer sheets

A separate engine (never mixed with teacher-awarded-mark extraction) will process
configured OMR sheets: candidate identifiers, filled bubbles/response fields, blank
responses, multiple selections, partially filled responses, answer-key configuration, and
optional scoring against a key. Rules:

- Ambiguous fills (partial, smudged) are **flagged, never silently scored**.
- Multiple selections follow the configured policy (invalid / multi-select) and are shown
  to the teacher.
- Scoring happens only against an explicitly configured answer key; the system never
  invents answers.
- See `STAGE_1_RECOGNITION_PLAN.md` §3 for the pipeline.

## 4. Live scanning workflow (target interaction)

Continuous live vision — not one photo per paper:

1. Teacher opens the scanning workspace. 2. Grants camera permission (once; denial has a
dedicated recovery path). 3. Camera continuously monitors the scanning area. 4. System
detects a page entering. 5. Waits for stability across sampled frames. 6. Checks quality
(sharpness, exposure, full-page visibility). 7. Processes the page **automatically**. 8.
Identifies paper type (ordinary vs OMR) or asks when uncertain. 9. Suppresses reprocessing
of the same page. 10. Shows the result and status. 11. Waits for the next paper.

**Required condition handling** (PoC implements the detection states; recognition is Stage 2+):

| Condition | Behavior |
|---|---|
| No paper | `WAITING` |
| Paper detected | `DETECTED` → `STABILIZING` → `READY` |
| Multiple/overlapping papers | `MULTIPLE_PAPERS` — teacher separates them |
| Movement | stability counter resets; no processing |
| Blurry / too dark | `QUALITY_INSUFFICIENT` — teacher adjusts lighting/focus |
| Partial page (out of frame) | not ready — teacher repositions |
| Unsupported layout | recognition returns "needs review", never a guess |
| Camera permission denied | dedicated recovery screen (Settings link, retry) |
| Camera disconnection | `CAMERA_UNAVAILABLE` + automatic reconnect attempts |
| Duplicate page | `PROCESSED` — suppressed until the teacher resets or the page leaves |
| App interruption | state machine resets; queued records persist locally (offline-first) |

**Efficiency contract:** sample frames at a configurable rate (default 5 fps sampling,
not 30–60 fps inference); run only cheap classical CV on samples; reuse the tracked
region; release the camera on leave. Measured cost in the PoC: **≈ 25–30 ms CPU per
sample** on the reference sandbox CPU (see `STAGE_1_ACCEPTANCE_TESTS.md`).

**Platform camera limitations (documented, verified in this repo):**

| Platform | Status |
|---|---|
| Web browsers | Live `getUserMedia` viewfinder **works today** (implemented in the existing app), torch via track constraints where exposed |
| Android/iOS in Expo Go | In-app camera module refused by the environment — **system camera** capture is the honest shipped path; a **dev build** unlocks a true in-app live viewfinder |
| Windows/macOS desktop | PoC webcam runner works via OpenCV `VideoCapture`; packaging is a Stage 3+ decision (see architecture doc) |

## 5. Excel / marks-register requirements (Stage 3+, specified now)

- Import/export `.xlsx` and `.csv`; auto-generated registers.
- **Student-ID and name mapping** to workbook rows; duplicate-student detection.
- Class, subject, examination, assessment configuration; recognition of existing
  assessment columns.
- Mark limits and grading conventions honored; **overwrite protection** for existing
  marks (default: write to a separate completed file, never in place).
- Ambiguous student matches are flagged for the teacher, never auto-assigned.
- **Preservation honesty:** values, layout of data sheets, and basic formatting are
  preserved; complex features (merged cells inside data ranges, pivot tables, charts,
  formulas, macros) require explicit per-feature testing and may degrade — each such
  feature gets a test case before we claim support.
