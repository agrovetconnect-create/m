# Stage 4 — Data Validation Rules
**AI Mark Entry System.** One implementation (`src/domain/`), used by UI, import
wizard, and tests — never only in the UI.

## Students
| Rule | Verdict |
|---|---|
| Name required (trimmed, non-empty) | error |
| Name ≤ 80 chars; ref ≤ 40 chars | error |
| Ref duplicate vs the class roster | error (a real same-student signal) |
| Ref duplicate inside the import file | error, first row named in the detail |
| Name duplicate inside the file (no refs) | error |
| Name matches an existing student, neither has a ref | **warning** — teacher decides |
| Name matches an existing student that HAS a ref | not a match (names are not identities) |

Identity normalization: case, whitespace, accents (NFD), Arabic/CJK preserved.

## Classes
- Duplicate = same normalized (name, grade) — creation wizard pre-fills the match.
- Search spans name, subject, grade.

## Assessments
- Name required; max mark must be finite and > 0 (spec: positive valid number).
- Duplicate (same normalized name within the class) is an error.
- Marks: Stage 3 `validateMark` unchanged — notNumeric/negative/aboveMax/
  tooManyDecimals/notFinite are rejected with explicit reasons; missing marks stay
  empty (never coerced to 0).

## Import classification
- **Errors** (block until resolved/skipped): missing name, in-file dupes, oversized
  cells, unsupported format, malformed file, too-large file.
- **Warnings** (never block): possible existing student (name-only).
- No record is ever silently discarded: skipped rows are teacher-chosen and counted
  in the summary; padding rows (fully empty) are excluded from totals by rule.
