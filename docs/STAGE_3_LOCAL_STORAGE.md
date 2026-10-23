# Stage 3 — Local Storage Foundation
**AI Mark Entry System.**

## 1. Model

The **Stage 1 data model is canonical** — this stage adds no new entities. The typed
form lives in `expo/src/domain/models.ts` (Student, Class, Assessment, PaperTemplate,
ScanningSession, ScannedPage, RecognitionResult/ExtractedMark, OMRResponse,
VerificationDecision, ExportJob, LicenseStatus, SyncStatus); the persisted shapes the
app ships today are `Entry`/`ClassRecord`/`StudentRecord`/`Settings` in
`lib/store.tsx`, which map onto those types (Entry ⇒ ExtractedMark +
VerificationDecision + SyncStatus, etc.). No fork, no second truth.

## 2. Current engine (shipped, working)

Encrypted **AsyncStorage** adapter, per Stage 1: AES-256-CTR + HMAC-SHA256 (RFC 4231
tested) before anything touches disk; a second encrypted copy of entries as crash
backup; audit photos local-only with retention; keys derived per record.

**Encryption claim, precisely:** records and settings are encrypted at rest with a key
in app-managed storage (Expo Go limitation documented). Keychain/Keystore-backed keys
require a dev build. This module adds no new encryption claims.

## 3. The seam (added in Stage 3)

`expo/src/storage/adapter.ts`:

- `StorageAdapter` — `getItem/setItem/removeItem` contract. Platform engines
  (encrypted AsyncStorage today, **SQLite in a dev build later**, MemoryStorage in
  tests/previews) implement the same interface; call sites never change.
- `runMigrations(adapter, migrations)` — versioned schema evolution: migrations run in
  order, the version marker is written only after each succeeds, gaps and corrupt
  version markers are refused, and a failed migration leaves the store at its previous
  version (retryable). Tested including the failure/rollback path.
- `safelyParse(adapter, key, parse, fallback)` — corrupt/incompatible payload recovery:
  fallback instead of crash, with the bad payload quarantined at `<key>.corrupt` for
  support, and no quarantine for healthy data.

## 4. What is persisted (and what deliberately isn't)

Persisted: settings, session, classes, students, mark entries (+ versions, signatures),
device id, schema version. Deliberately **not** persisted by default: camera frames
(never continuously), recognition internals beyond the extracted fields, secrets beyond
the settings record.

## 5. Entities requiring future storage (not yet needed)

Paper templates, OMR responses (as separate rows), export jobs, license records,
pending-sync jobs — the Stage 1 data model defines them; their tables/persisted shapes
land with their features (recognition/licensing stages) on this same adapter +
migration runner. Nothing is stubbed with fake rows now.

## 6. Transactions, backups, recovery

- Multi-record changes: the live store writes entries + backup copy together; the
  migration runner's version-marker protocol provides the same atomicity for schema
  changes.
- Backup boundary: local encrypted backup copy (existing) + signed cloud sync when
  online (existing). Cryptographic erasure on deletion is the Stage 3 spec (Stage 1
  security doc §7) — implementation stays scheduled with the dev build.
- Corrupt data: `safelyParse` fallback + quarantine; the app boots to empty-state
  rather than crashing; the backup copy is attempted before any destructive repair.
