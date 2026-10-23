# Stage 1 — License & Account Model
**AI Mark Entry System** — design specification only. No payment gateway, subscription
platform, or license-verification service is built in Stage 1.

## 1. Purchasing paths

### Individual license
One teacher buys a license (one-time or subscription — pricing decided commercially, not
in Stage 1), activates it in-app with a license key or store purchase, and manages it
alone. **No school administrator, institution, or government participation is involved.**

### Institutional license
A school/university buys a bundle of `N` seats. An institutional license administrator
assigns seats to teacher accounts by email; assigned teachers activate with one tap. The
administrator manages seats and sees license status only — **never access to marks data**.

## 2. Offline operation (already-activated licenses)

- Activation writes a **signed local activation record**: license id, seat id, device
  fingerprint, issued/expiry timestamps, and the issuer's signature (asymmetric — the
  public verification key ships in the app; the signing key never does).
- **Configurable grace period** (proposed default: 14 days, vendor-tunable): while
  offline, the app re-verifies the record's signature locally and continues to operate.
- **Expiry behavior:** after expiry + grace, the app blocks new scanning but keeps
  viewing/exporting existing records — teachers never lose their own data.
- **Renewal:** any successful online contact re-validates and extends; a renewal purchase
  issues a new signed record.
- **Anti-tamper honesty (explicitly required):** a client-side boolean is never trusted.
  Verification = signature check + device binding + server confirmation when online.
  This is *resistant*, not *unbreakable* — documented assumption: determined pirates can
  patch any client; the goal is making casual sharing uneconomical, and institutional
  audits can detect seat overuse server-side when online.

## 3. What validates locally vs. requires an online service

| Capability | Local (offline) | Online |
|---|---|---|
| Continue using an activated license | ✅ signature + device binding | — |
| First activation of a purchased key | ✗ | ✅ license service |
| Seat assignment/revocation | ✗ | ✅ |
| Renewal / upgrade | grace-period continuation | ✅ |
| Usage analytics for seat audit | buffered locally | ✅ batch upload |

## 4. Stage boundary

Stage 1 delivers this specification and the data-model slots (`License` in the data
model). Stage 2+ builds: license issuing service, store integrations (Google Play
Billing / Apple IAP / desktop payment), and the activation flow. Real store billing
today is blocked on the owner's store accounts (existing plan note).
