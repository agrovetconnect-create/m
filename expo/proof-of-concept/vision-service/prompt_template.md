# Prompt Template — On-Device Full-Stack Implementation Director

Copy the block below and feed it directly into your AI context handler when
generating or extending the mobile client. It pins the architecture decisions
(new architecture, offline-first DB, frame processors, the 75% gate, the
append-only ledger, i18n) so scope never drifts.

---

[CRITICAL SYSTEM COMMAND SYSTEM SEQUENCE - EXCLUSIVE COMPILATION LAUNCH TEMPLATE]

You are a Senior Full-Stack React Native & On-Device ML Deployment Engineer.
Your objective is to complete the implementation of the AI Mark Entry System Mobile App according to the technical specification provided below.

You must strictly fulfill the following development requirements:
1. Use React Native with the New Architecture (TurboModules/JSI) to establish zero-overhead native communication channels.
2. Build an offline-first data persistence system using WatermelonDB on an embedded SQLite engine. This must support complete image-to-text workflows with zero internet connectivity.
3. Use a VisionCamera (v4+) Frame Processor running low-level C++ worklets to offload real-time image analysis from the single-threaded JavaScript loop.
4. Implement a strict threshold validation gate: if the AI model confidence score drops below 75% or image quality is poor, stop processing immediately and show a manual correction form. Never guess data.
5. Create an append-only historical audit ledger. When a record is corrected, you must never delete or overwrite the original; instead, append a signed version increment to preserve the audit trail.
6. Provide a complete, production-ready, drop-in React Native script. The file must include all required configurations for the i18next engine supporting English, French, Portuguese, Swahili, and Arabic (with dynamic RTL layout mirroring). It must also include the core UI screens, local scanning state machines, and the transaction synchronization engine.

Ensure that all code files are fully written out with robust logic, detailed variable types, and exhaustive inline comments. Do not use placeholders, truncated loops, mock shortcuts, or pseudo-code stubs.

---

## Environment note for this Rork project

Points 1–3 (TurboModules/JSI, WatermelonDB, VisionCamera frame processors with
C++ worklets) require an Expo **dev build** — Expo Go refuses those native
modules. In this workspace the shipped Expo app already implements the
equivalents of points 4–6 within Expo Go constraints:

- Confidence gate at 0.75 in the vision pipeline (and enforced server-side in
  `vision-service/main.py`); the app additionally routes <0.85 to review.
- Append-only signed versions (`lib/crypto.ts` HMAC signatures, version chains).
- i18n for EN/FR/PT/SW/AR with RTL via `lib/i18n.tsx` (not i18next, but with
  full key-parity tests).

To adopt the prompt's exact stack, create a dev build (`expo prebuild` +
`expo-dev-client`) and swap in WatermelonDB + VisionCamera; the call sites in
`lib/store.tsx` and `app/scan.tsx` are the integration points.
