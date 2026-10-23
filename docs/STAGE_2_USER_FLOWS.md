# Stage 2 — User Flows & Interaction States
**AI Mark Entry System.** For each flow: entry → actions → the four states (loading /
success / failure / recovery), cancel behavior, and data preservation. Common rules
apply to every flow:

- **Cancel** leaves the record exactly as found (no partial writes).
- **Data preservation:** anything the teacher produced is saved locally first; leaving a
  screen never discards review work; no timeouts on review.
- **Destructive steps** (delete approved marks, overwrite a register, delete cloud data)
  always pass `ConfirmDialog` with a verb-named confirm button.
- Offline is a first-class state, shown honestly; sync resumes automatically (NetInfo
  push) without user action.

## 1. First launch
Entry: install → onboarding → data consent → sign-up/in.
Loading: splash → onboarding; Failure: consent blocked → explain, allow retry;
Success: Home first-run state (setup actions, no fake stats); Cancel: app usable after
consent is required by policy (consent is mandatory before cloud sync only).

## 2. Individual teacher setup
Sign up (email or OAuth) → profile (name/school optional) → language → done. Failures:
email exists, weak password, network — each with a specific message and a recovery path
(sign-in link, reset password). Cancel: account half-created → sign-in flow completes it.

## 3. Create a class manually
Marksheets → Add class → name + subject(s) → save. Validation: name required; duplicate
name → warning with merge/keep options. Success: class appears; Failure: save error →
draft retained.

## 4. Import a student list
Class detail → Import roster → pick .xlsx/.csv → preview rows → validate (missing ID,
duplicate ID, malformed rows reported by row number) → resolve or skip flagged rows →
confirm. Loading: parse indicator; Failure: file unreadable → explanation + format help;
Cancel: nothing imported.

## 5. Import an existing Excel register
Marksheets → Import register → sheet/header selection → column mapping (ID, name,
assessment, mark) → validation report (missing students, out-of-range marks, duplicates)
→ resolve → confirm → **new output copy** (source untouched). Failure: unmapped
required column blocks confirm with the offending column named.

## 6. Generate a new marks register
New marksheet → class/group + students + subject + assessment + max marks → preview
template → generate. Failure: empty class → EmptyState points to roster import.

## 7. Configure ordinary marked-paper processing
Mark Entry setup, paper type = ordinary papers → (optional layout template) → review →
start scanning. No answer key involved; engine reads awarded marks only, never grades.

## 8. Configure OMR processing + answer key
Paper type = OMR → select/create sheet template → answer key: define per question
(single/multi-select policy) or load a key file → key stored with the assessment →
review → start. States: key incomplete → explicit "score later" choice (responses
recorded, scoring deferred) — never silent partial scoring.

## 9. Start / pause live scanning
Scan screen → Start → live viewfinder + HUD. Pause: freezes capture, keeps session
state; Resume: continues; Stop: routes to review with unprocessed counter. Camera lost
mid-session → `CAMERA_UNAVAILABLE` state + reconnect (PoC behavior) — session state
preserved.

## 10. Detect and process a paper
Paper placed → stability (PoC READY pulse) → capture → engine read → confidence gate:
≥0.75 → result card (pending approval); <0.75 or unreadable → manual-entry path with
the reason named. Loading: processing indicator with measured latency; Failure: engine
unreachable → honest unavailable state, retry or manual.

## 11. Resolve an ambiguous recognition result
Review list (needs-review badge) → open result → source image beside fields → edit ID/
mark or change student match → save → becomes `corrected` → approve. Duplicate student
match → both candidates shown, teacher picks; no auto-pick.

## 12. Correct and approve a mark
Result card → edit field (validation: numeric, ≤ max marks) → Approve → `approved`
badge + version history entry + signed local record (syncs when online). Rejection:
`rejected` badge, paper can be retried. Approved marks are never silently changed —
edits create a new version.

## 13. Handle a duplicate student or assessment
Import/scan hits an existing student/assessment → warning card: keep existing, merge,
or replace (replace = `ConfirmDialog`). Assessment duplicate: attach new session to the
existing assessment rather than creating a shadow copy.

## 14. Export a completed register
Report/marksheet → Export → choose format/columns → generate file → share/save.
Loading: generation indicator; Success: file location shown + History entry; Failure:
generation error → retry; export marks rows `exported` only after the file exists.

## 15. Continue working offline
Network drops → offline badge (real radio state) → all entry/approval/review keeps
working locally; queue counter visible; sync resumes automatically on reconnect (no
user action needed; manual "Sync now" also available).

## 16. Recover from an interrupted scanning session
App killed/crashed mid-session → relaunch → Home shows the interrupted session
(resume or discard — discard is `ConfirmDialog`); approved reads were already saved
locally at approval time, so nothing approved is lost.

## 17. Resolve a synchronization conflict (sync enabled)
Push rejected as conflict → resolve-conflict screen: local vs server values side by
side with timestamps → keep either/both (both = new version) → resolved record syncs
clean. Conflicts never overwrite silently (server-signature tracking).

## 18. Activate / renew / troubleshoot a license
Stage 1 spec: activation requires the online license service; offline grace continues
from the signed local record. UI states: active (expiry shown), grace (countdown,
renewal nudge — non-blocking), expired (new scanning blocked; existing records viewable/
exportable), activation failure (reason + retry + license help). **Backend is Stage 3+;
the Settings License section stays disabled-with-explanation until then.**
