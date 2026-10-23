# Stage 1 — Data Model & Data Ownership
**AI Mark Entry System** — conceptual model; physical DDL is Stage 2/3 work.

## 1. Entities and relationships

| Entity | Key fields (beyond id) | Relationships | Exists in repo today? |
|---|---|---|---|
| **User** | `id` (UUID), email, name, role, created_at | owns licenses, classes, sessions | ✅ (teacher auth) |
| **License** | `id`, key/fingerprint, type (individual/institutional), seats, activated_at, expires_at, grace_days | belongs to user or institution | ✗ (specified, Stage 2+) |
| **Institution** | `id`, name | has many licenses/users | ✗ (optional, later) |
| **Class** | `id`, name, term | has students, assessments | ✅ |
| **Student** | `id`, class_id, reg_no, full_name | belongs to class; matched to extracted identifiers | ✅ |
| **Subject** | `id`, name | groups assessments | ◐ (via class config) |
| **Assessment** | `id`, class_id, subject, name, max_mark, date | has many entries | ◐ |
| **Paper template** | `id`, type (ordinary/omr), zone map, denominators | used by scanning sessions | ✗ (Stage 2) |
| **Scanning session** | `id`, class_id, assessment_id, started_at, ended_at, device_id | groups scanned pages | ✅ (chain mode counter) |
| **Scanned page** | `id`, session_id, image_ref (retention-timed), paper_bounds, quality | has recognition result | ✅ (transient in-memory; not persisted) |
| **Recognition result** | `id`, page_id, engine, raw_contract_json, confidence | yields extracted marks / OMR responses | ✅ (frame contract) |
| **Extracted mark** | `id`, result_id, student_id, value, denominator, confidence, zone | verified into entry | ✅ (entry + confidence) |
| **OMR response** | `id`, result_id, question_no, state (filled/blank/multi/ambiguous), selected | scored against key | ✗ |
| **Answer key** | `id`, assessment_id, answers_json | used by OMR scorer | ✗ |
| **Verification decision** | `id`, target (mark/response), decision (approved/edited/rejected), by, at, note | audit-linked | ✅ (version history + confirm flow) |
| **Export job** | `id`, assessment_ids, format, status, file_ref | produced from approved records | ✗ (Stage 3) |
| **Audit event** | `id`, actor, action, entity, at, meta | append-only | ✅ (version history + event journal) |
| **Synchronization job** | `id`, record refs, status (pending/failed), attempts, device_id | pushes local→cloud | ✅ (sync queue + sync log) |

Identifiers are UUIDs; every record carries `created_at`/`updated_at` and a status field.

## 2. Record statuses (the system distinguishes all of these)

`detected → processing → processed → needs_review → approved | rejected → exported`,
plus sync states `sync_pending` / `sync_failed` per record. Mapping to the existing
implementation: entries already carry `status` (confirmed/flagged/pending) and `synced`;
Stage 2 introduces the fuller enum verbatim.

## 3. Local-first ownership

**Must be local (device) and functional offline:** classes, students, rosters, paper
templates, scanning sessions, recognition results, verification decisions, exports,
license activation record (grace period). The app is fully usable with zero connectivity —
already true today.

**May optionally sync:** approved/reviewed records (as signed payloads), classes and
rosters, license status. **Never syncs:** raw camera frames (see §4), encryption keys,
passwords. Cloud data is RLS-scoped to the owning teacher — already enforced on the
existing tables.

## 4. Camera frames & retention

- Frames are processed **in memory only**; video is never recorded continuously.
- A still image is retained **only** when the teacher's chosen workflow requires an audit
  photo, encrypted at rest, with a configurable retention (current default: 90 days) and
  explicit secure deletion (overwrite + key destruction) — Stage 3 hardens deletion to
  cryptographic erasure.
- Diagnostics (bounds, quality numbers, timings) are retained without images.

## 5. Later-stage requirements (specified now, not built)

Secure deletion, encrypted backup/restore with conflict resolution (last-writer-wins with
signature validation today; merge UI later), and license-record recovery. Passwords are
never stored by the app (Supabase auth); privileged service credentials never ship in
clients — the CV refresh token is stored AES-256-encrypted, password never stored.
