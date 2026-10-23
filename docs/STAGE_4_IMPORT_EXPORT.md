# Stage 4 — Excel/CSV Import & Export
**AI Mark Entry System.**

## Import wizard (12-step flow, as specced)

1. **Select file** — platform-appropriate: Android = system document framework (SAF;
   teacher picks the folder, then the file when several qualify — never auto-picked);
   web = real `<input type=file>`. Original files are only ever READ.
2. **Validate type/size** — `.xlsx`/`.csv`/`.txt` accepted, 5 MB guard before parsing,
   ZIP magic-byte check (renamed junk ⇒ `malformed`), `.xls` honestly unsupported.
3. **Parse** — data-only readers (xlsx-lite / RFC 4180 CSV). No formula or macro
   evaluation is possible: values are read as strings/numbers, nothing else.
4. **Worksheet preview/choice** — multi-sheet workbooks list sheets with row counts.
5–6. **Header row** — auto-detected, teacher can toggle "first row is the header".
7. **Column mapping** — auto-hints (Name/Student/Pupil/Nom/Nome/Jina/الاسم…;
   ID/Reg/Admission/Roll/Matric/Candidate/No…), ALWAYS shown for correction via
   column pickers; a wrong guess is never silently imported (tested).
8. **Normalized preview** — every non-empty row with its parsed name/ref and issues.
9. **Validation** — errors vs warnings, each with the 1-based data-row number and a
   plain-language reason: missing name, duplicate ref in file, duplicate name in file
   (when no refs exist), oversized cells, possible existing student (name-only).
10. **Duplicate resolution** — ref matches default to SKIP (re-importing the same
    register creates nothing); teacher can choose *update existing* (explicit
    overwrite with confirmation) or *keep both*. Unresolved errors block Confirm.
11. **Confirm** — nothing written before the teacher confirms.
12. **Atomic persistence + truthful summary** — one `setStudents` write (a single
    encrypted AsyncStorage write: crash ⇒ old or new roster, never partial). Summary
    counts computed from the actual plan: total rows, valid, new, existing matched,
    updated, duplicates detected, invalid, skipped, committed.

## Export

- **Excel (.xlsx):** dependency-free writer; confirmed entries only; clean, formatted
  output — **no claim that source-workbook formatting/formulas are preserved** (the
  source is never edited in place; `assertSafeExportTarget` + `uniqueName` prevent
  any overwrite). Real file via SAF on Android; labeled CSV share fallback on web.
- **CSV:** RFC 4180 writer, real file via SAF, same fallback.
- **Missing ≠ zero:** a missing mark is an empty cell; a zero is `0` — both survive
  the xlsx and CSV round-trips (tested).
- **Formula safety:** text cells starting with `= + - @` are prefixed with `'` in
  BOTH formats so no spreadsheet can execute them; numeric marks travel as numbers
  (tested via reopen).

## Verification (automated, real reader/writer round-trips)

Every export format is reopened and asserted: headers, row counts, identifiers,
representative values, blank-vs-zero, non-English names (Arabic, Chinese, diacritics),
punctuation, and formula-triggering text. Empty registers produce an empty (valid)
plan, never fabricated rows.
