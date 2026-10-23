# Stage 4 — Register Management
**AI Mark Entry System.**

## What exists (real, wired)

| Capability | Where | Status |
|---|---|---|
| Create class (name/subject/grade) | `class-setup.tsx` → `addClass` | existed; now routes roster import through the wizard |
| Duplicate-class rule | `findDuplicateClass` — normalized name + grade | new, tested |
| Class search/filter | `filterClasses` — case/accent-insensitive over name, subject, grade | new, tested |
| Real record counts | class lists derive student counts from the store | existed; no hardcoded stats anywhere |
| Add/import students | `addStudents` (paste path) now ref-dedupes; wizard for files | extended, tested |
| Student identity | `ref` = stable id; name-only match is a warning, never a merge | new policy, tested |
| Duplicate resolution | wizard review step: skip / update / keep both per row | new |
| Assessments | name + class + teacher max mark; duplicate rule (same normalized name in class) | new validation, tested |
| Digital register | class → students → assessment marks: `marksheet.tsx`/`entry-sheet.tsx` | existed (missing ≠ zero: empty input stays null) |
| Mark validation | Stage 3 `validateMark` (max bounds, decimals, negatives, non-numeric) | existed, reused unchanged |
| Safe deletion | `deleteClass` exists from earlier rounds; destructive flows confirm first | preserved |

## Deliberate limits (honest)

- Class/student archive-restore: the Stage 1 data model defines archived states, but
  the live store ships only live records; archive UI was not built in this stage and
  is not claimed.
- Student editing beyond the import-resolution path (rename in place) remains part of
  the existing student screens' roadmap; assessment results are keyed to the class +
  name and preserved by the store's version history.
- Merging two real duplicate students (moving their entries) is intentionally NOT
  automatic — the store has no merge operation; the teacher keeps/updates/skips at
  import time.
