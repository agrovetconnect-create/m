# Stage 4 — Testing Guide (register management & import/export)
**AI Mark Entry System.**

## Where the tests live

| Suite | File | Covers |
|---|---|---|
| CSV (RFC 4180) + export sanitization | `expo/tests/stage4-register.test.ts` | parser/writer round-trips, formula-neutralization (xlsx AND csv) |
| Student/class/assessment rules | same file | validation, duplicate detection, explicit resolution |
| Import engine | same file | the full pipeline end-to-end |
| Prior Stage 4 (export pipeline, OMR, register builder, xlsx writer) | `expo/tests/stage4.test.ts` | export-job lifecycle, round-trips |
| Domain marks, scanning, storage, files, config | `expo/tests/foundation.test.ts` | unchanged regression |
| All prior suites | `bun test` | 127 tests total |

## Running

```bash
cd expo && bun test        # 127 tests
# static gate
#   runChecks(appPath: "expo") — tsc + lint + structure, 0 errors
# web build
cd expo && bunx expo export --platform web
```

## Import-engine coverage (all against the REAL parsers/writers)

- Valid `.xlsx` import — workbook **generated with the writer**, parsed with the real
  reader (a true round-trip, not a fixture).
- Valid `.csv` import; header-name variants (`Full Name`, `Registration No`,
  `Candidate ID`, `Roll`, whitespace/case).
- Teacher-corrected mapping overriding wrong auto-mapping.
- Missing required fields (with row numbers), empty padding rows, empty files.
- Duplicate refs within one file (first row named); re-import of the same register
  ⇒ **zero new students** (ref match defaults to skip).
- Possible-existing-student warnings (name-only, no refs) — warning, not error.
- Confirmation gating: unresolved errors block; explicit skip unblocks and is counted.
- Explicit update (only overwrite path) and keep-both paths.
- Malformed (renamed non-ZIP), unsupported (`.xls`), oversized (> 5 MB) rejections.
- Non-English names & special characters through the whole pipeline.
- Full export→import round-trip of a real register: reopen, auto-map, zero duplicates.

## Export coverage

- xlsx/CSV reopened and asserted: headers, row counts, values, `0042` stays text,
  marks stay numbers, blank vs zero distinguished, `=SUM/+25/-x/@y` neutralized.

## UI walkthrough (manual, needs a device/emulator)

Create class → import file via wizard (see the mapping, resolve a duplicate, confirm,
check the summary) → create assessment → enter marks → export xlsx/CSV → reopen the
files in Excel/Sheets. The Android SAF dialogs require a real device (sandbox has no
emulator) — documented as the BLOCKED remainder in the completion report.
