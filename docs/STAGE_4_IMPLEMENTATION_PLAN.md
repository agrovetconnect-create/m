# Stage 4 Implementation Plan — Register Management, Student Records & Excel/CSV Import/Export
**AI Mark Entry System.** Written before implementation per the Stage 4 master spec
(this document supersedes the earlier Stage 4 note covering OMR/export groundwork;
that groundwork — the dependency-free .xlsx writer, register builder, export-job
lifecycle — is Stage 4 export capability and is preserved, extended, and re-tested
here, never discarded).

## Step Zero findings (inspected before any edit)

- Baselines green: bun 98 pass, runChecks 0, web export PASS. Stages 1–3 docs in `docs/`.
- **Already real:** class create (+ sync), student records (name + optional `ref`),
  assessments as named strings with teacher max marks, mark entry validated by the
  Stage 3 `validateMark` (missing ≠ zero in the entry grid: empty input stays `null`),
  marksheet register (class → students → assessment), class report with real Excel
  (.xlsx via the dependency-free writer + Android SAF) and CSV share, entry version
  history, offline-first encrypted store.
- **Gaps vs this spec:** no CSV import (no parser), no teacher-correctable column
  mapping UI (`rebuildRoster` existed unused), no import preview/validation/duplicate
  resolution/summary, `addStudents` appends blindly (reimport ⇒ duplicate students),
  no class duplicate rule or search, no assessment duplicate rule, exports not
  formula-sanitized, CSV export is share-sheet text rather than a file.
- Platforms: Expo (Android/iOS/web) confirmed; Android file access via StorageAccess
  Framework (legacy expo-file-system), already a working dependency.

## Key policies (defined now, tested below)

- **Student identity:** `ref` (registration/candidate number) is the stable
  identifier when present on BOTH records — normalized exact match = same student.
  A name match alone is NEVER an automatic merge: it is a *warning* with the reason
  shown, and the teacher resolves it explicitly (skip new record / update existing /
  keep both). Ref conflicts with different names are surfaced, not auto-resolved.
- **Import dedupe:** within-file duplicates by ref (or normalized name when no refs)
  are errors the teacher resolves; re-importing the same file matches every row to
  existing students and creates nothing unless the teacher explicitly chooses
  "keep both".
- **No silent overwrite:** updating an existing student's name/ref happens only when
  the teacher confirms the proposed change per duplicate-resolution row.
- **Persistence safety:** one import = ONE `setStudents` state write (the encrypted
  store persists whole arrays in a single AsyncStorage write), so a crash mid-import
  leaves either the old or the new roster, never a partial one. That is this
  architecture's rollback guarantee; documented honestly (no relational transactions
  exist here).
- **Spreadsheet safety:** imports are data-only — xlsx-lite parses values, never
  evaluates formulas or macros; exports sanitize text cells whose first character is
  one of `= + - @` (prefixed with `'`) so spreadsheets cannot execute them, while
  numeric marks stay numbers. CSV round-trips per RFC 4180.
- **Never-overwrite-source:** export targets are new files (`assertSafeExportTarget`
  + `uniqueName` from Stage 3); generated workbooks are clean and professionally
  formatted — no claim is made that original workbook formatting/formulas are
  preserved (they are not edited in place, ever).
- **Dependencies:** ZERO new dependencies (dependency review doc justifies: existing
  in-repo xlsx-lite reader + Stage 4 writer cover .xlsx/.csv; .xls stays rejected —
  honestly reported, not silently accepted).

## Build order

1. CSV parser/writer (RFC 4180) + export sanitization + tests.
2. Domain: students (validation, duplicate detection), classes (duplicate rule,
   search), assessments (validation, duplicate rule) + tests.
3. Import engine: sheets → header row → column mapping (auto hints, teacher-corrected)
   → normalized preview → issues (errors/warnings with row numbers) → in-file and
   vs-existing duplicates with reasons → plan with real summary counts + tests
   (including xlsx round-trip: generate workbook with the writer, import through the
   real reader).
4. Store: ref-dedupe in `addStudents`, atomic `importStudents(new, confirmed updates)`.
5. Import Wizard screen: pick (.xlsx/.csv) → sheet/header → mapping → preview →
   duplicate resolution → confirm → truthful summary; wired from class setup.
6. Real .csv file export (SAF) with share fallback.
7. Docs (7 files) + completion report with measured evidence.

## Non-goals (per master spec §13)

No recognition/OMR wiring into live scanning this stage, no billing/licensing
activation, no cloud sync service changes, no attendance/fees/timetables, no
architecture migration. Interfaces stay ready for future integration.
