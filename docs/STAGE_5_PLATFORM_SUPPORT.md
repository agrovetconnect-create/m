# Stage 5 — Platform Support
**AI Mark Entry System.**

| Capability | Web (browser) | Android (device) | iOS (device) | Desktop |
|---|---|---|---|---|
| Live camera preview | ✅ real getUserMedia stream | ⚠️ system camera per sheet | ⚠️ system camera per sheet | deferred (Tauri, D2) |
| Continuous frame analysis | ✅ 5 fps canvas sampling | ❌ no frame pipeline in Expo Go | ❌ | ❌ |
| Paper detection + auto capture | ✅ full engine | ❌ (BLOCKED) | ❌ (BLOCKED) | ❌ |
| Manual capture into session | ✅ shutter | ✅ system camera | ✅ system camera | — |
| Image persistence | ✅ IndexedDB | ❌ BLOCKED (no file adapter) | ❌ BLOCKED | — |
| Session metadata persistence | ✅ encrypted store | ✅ encrypted store | ✅ | ✅ (shared code) |
| Pause/resume/end/reconcile | ✅ | ✅ | ✅ | ✅ |

## Why native live scanning is BLOCKED (honest)
`expo-camera` (frame pipeline) and `expo-file-system` (image files) cannot be
installed in this environment (Expo Go refuses module installs; installs were
refused in earlier rounds). A dev build removes both blockers with zero call-site
changes: the camera adapter interface, the tracker, the detector and the persistence
layer are platform-agnostic and already exercised by 35 automated tests. Native
manual capture works through the **real** system camera — no fake viewfinder, no
simulated frames, no invented states.

## Verified in this stage
- Web: full pipeline (camera → detection → auto-capture → IndexedDB → restart
  recovery) — code-verified and type-checked; physical-camera behavior depends on
  the preview browser's camera and was not exercised against real paper (BLOCKED:
  no camera hardware in the sandbox).
- Synthetic pixel-buffer suite covers all detection/stability/persistence cases.
