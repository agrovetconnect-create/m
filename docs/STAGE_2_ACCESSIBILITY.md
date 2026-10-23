# Stage 2 — Accessibility
**AI Mark Entry System** — requirements, what is implemented and verified, and what is
specified for later. Standard: WCAG 2.1 AA as the baseline, adapted to mobile norms.

## Verified in this stage (measured, not eyeballed)

- **Contrast:** all token text/background pairs ≥ 4.5:1 in **both** themes — asserted by
  `tests/design-system.test.ts` computing real WCAG ratios. Two light-theme status
  colors that measured 4.1–4.4:1 were retuned (warning, danger) rather than exempted.
- **Status is never color-only:** every semantic status pairs an icon + text label
  (`statusSemantics`), enforced by test.
- **Touch targets:** `TOUCH_TARGET = 44` token; new components use it; the existing
  `ScreenHeader`/tab bar already use 44pt targets.
- **Reduced motion:** the app's only motion is the `Press` 0.97 scale + fade transitions;
  RN honors the OS reduce-motion setting for system animations. No polling spinners or
  parallax exist. Documented rule: no new decorative animation.

## Implemented app-wide (carried from earlier stages, re-verified)

- Semantic roles/labels: interactive elements use `accessibilityRole`/`accessibilityLabel`
  (`Press`, tabs, `ConfirmDialog`); RTL layout applies for Arabic (`applyDirection`).
- Screen-reader announcements: error/success regions use `accessibilityLiveRegion` where
  supported (`ErrorState`); scan HUD results are announced on update.
- Dialogs: `ConfirmDialog` uses `accessibilityViewIsModal` + `onRequestClose` (back
  gesture cancels); destructive confirm buttons name the action.
- Labels: all inputs have visible labels (no placeholder-only fields).

## Specified for Stage 3 web/desktop shell (exact parity not possible on mobile)

- **Keyboard navigation & visible focus:** full tab-order + `:focus-visible` rings apply
  to the web/desktop shell; native mobile uses platform focus patterns instead.
- **Semantic headings:** native uses RN accessibility headings (`accessibilityRole="header"`
  on `ScreenHeader` title — applied); HTML heading levels apply on web.
- Screen-reader status announcements on web via `aria-live` regions.

## Honest limitations

- Contrast is verified for the **token layer**; legacy screens using `C.*` constants are
  covered because the light palette *is* those values (sub/danger/warning retuned tokens
  diverge slightly — legacy screens keep the old values until the `useTheme()` migration).
- VoiceOver/TalkBack walkthroughs on real devices are **BLOCKED** in this environment
  (no device) — labels/roles are in place but a hardware audit remains open.
- Dynamic Type / font scaling: system fonts are used (they scale), but some dense scan-
  screen HUD rows may clip at the largest accessibility sizes — queued for the Stage 3
  responsive pass, not silently ignored.
