# Stage 1 — Privacy, Security & Trust Requirements
**AI Mark Entry System** — requirements + current implementation status. We do **not**
claim legal/regulatory compliance; applicable regimes (e.g., GDPR for EU users, Kenya DPA
for the launch market, FERPA/COPPA where US institutions apply) require counsel-backed
evidence packs — listed as Stage 2 prerequisites.

## 1. Student data minimization
Only what the register needs: student ID, full name, marks, class/assessment context.
No demographics, no behavioral data. Recognition engines return exactly three paper reads
(ID, name, marks) — enforced by the strict frame contract. Camera frames are processed in
memory and never persisted unless the teacher's workflow explicitly opts into audit
photos (retention-capped, encrypted).

## 2. Camera permission & visible scanning status
Camera permission is requested once, with a denied-state recovery screen (Settings link +
retry). A visible scanning indicator/state is part of the detection PoC's state machine
(overlay states), so the teacher always knows when the camera is active.

## 3. Local-first processing
Detection and (in the shipped CV mode) recognition run on-device or on the school's own
server. The **cloud-AI engine is optional and clearly labeled**; the offline manual path
always exists. Core workflow never requires internet.

## 4. Secure local storage & encryption
- Records, session, and settings (including the CV refresh token) are **AES-256-CTR
  encrypted** at rest with HMAC-SHA256 integrity signing — implemented and unit-tested
  (RFC 4231 vectors).
- Known gap (documented): the key lives in app storage under Expo Go; **Keychain/
  Keystore-backed keys require a dev build** — Stage 2 prerequisite.
- All traffic is TLS (HTTPS) in transit.

## 5. Authentication & access control
Supabase email/password + Google/Apple OAuth (JWT); every cloud request carries the
teacher's token; Postgres RLS scopes each teacher to their own rows. Shared/institutional
devices: sign-out ends sessions server-side; local records are re-keyed on sign-out
(deep device-sharing hardening is Stage 3).

## 6. Audit history
Every mark keeps a version history (who/when/what + note) and approvals are recorded —
implemented. Client event journal covers diagnostics without PII (messages truncated,
no content).

## 7. Backup, recovery & protection against overwriting
Offline-first local store + optional signed sync; conflicts are flagged for teacher
review, never silently overwritten (server-signature tracking implemented). Secure
backup/restore and cryptographic erasure are specified in the data model for Stage 3.

## 8. License verification & dependency licensing
Per `STAGE_1_LICENSING.md`: asymmetric signed activation records; no boolean trust.
Dependencies reviewed in Stage 1: Apache-2.0 (OpenCV, Tesseract, FastAPI, Expo core,
AsyncStorage, NetInfo), MIT (React Native core, React Query, bun runtime), Supabase
client licenses — all commercial-use compatible; vendored `aes-js` is MIT. ONNX Runtime
(MIT) and PaddleOCR (Apache-2.0) are license-safe Stage 2 candidates.

## 9. Safe diagnostic logs
No secrets, tokens, or student content in logs (verified by grep sweep this stage); error
messages truncated and content-free.

## 10. Data deletion & retention
In-app data-deletion request deletes cloud data for real (implemented); local retention
default 90 days, configurable. Stage 2 adds documented retention schedules per data class.

## 11. Recognition suggestions vs. approved records
Hard rule, already enforced: **a recognized mark is a suggestion until the teacher
approves it.** Confidence-gated reads (below 0.75) never save; the verification UI is the
only path into the signed record store.
