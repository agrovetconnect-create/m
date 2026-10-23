# Stage 2 — Design System
**AI Mark Entry System** — the token layer and component architecture, implemented in
`expo/src/design-system/` on top of the approved Stage 1 visual language (the mockup-
derived palette in `components/ui.tsx`). Nothing existing was replaced.

## 1. Architecture

```
expo/src/design-system/
├── tokens.ts      # spacing, radii, type scale, breakpoints, icon sizes, elevation,
│                  # TOUCH_TARGET, statusSemantics (status → tone + icon)
├── palettes.ts    # lightPalette (= the approved C values, semantic names)
│                  # + darkPalette (same shape, dark-ground contrast retuned)
├── resolve.ts     # pure theme logic: resolveTheme(), normalizePreference() — testable
├── theme.tsx      # ThemeProvider + useTheme(); preference persists on the
│                  # encrypted settings record (settings.theme, default "system")
└── components.tsx # StatusBadge, ConfidenceIndicator, EmptyState, ErrorState,
                   # Skeleton, LoadingRow, ConfirmDialog
```

**Rule:** screens read colors only via `useTheme()`; new hexes go in `palettes.ts` only.
The legacy flat `C` object stays for unmigrated screens and is the source of the light
palette values — one migration path, no fork.

## 2. Color tokens (both themes share the shape)

| Token | Light | Dark | Use |
|---|---|---|---|
| `bg` / `card` / `fieldBg` / `chip` / `row` | surfaces | inverted surfaces | screen, cards, inputs, chips |
| `ink` / `sub` / `faint` | text | text | primary / secondary / disabled |
| `line` / `hairline` | borders | borders | cards, separators |
| `brand` / `brandDeep` / `brandTint` / `brandChip` / `onBrand` | green family | light-green family | primary actions, active nav |
| `success`+`Bg`, `warning`+`Bg`, `danger`+`Bg`, `info`+`Bg`, `neutral`+`Bg` | status | status retuned | badges, alerts — always paired with an icon |
| `track` / `trackOff` / `scrim` | misc | misc | progress, switches, dialogs |

Contrast contract, **measured by `tests/design-system.test.ts`**: every text/background
pair above ≥ 4.5:1 (WCAG AA) in both themes; brand-on-brand ≥ 4.5:1.

## 3. Non-color scales

- **Spacing** (4-pt grid): `xs 4 · s 8 · m 12 · l 16 · xl 20 · xxl 28 · xxxl 40`
- **Radii**: `s 8 · m 14 · l 16 · pill 28`
- **Type**: `caption 12/600 · body 15.5/400 · bodyStrong 16/600 · title 20/800 · display 26/800` — system font, Dynamic Type respected
- **Breakpoints**: `phone <600 · tablet 600 · desktop 900 · wide 1200` (`breakpointOf(width)`)
- **Icon sizes**: `16 / 20 / 24`; **touch target ≥ 44×44** (token `TOUCH_TARGET`)
- **Elevation**: border-led design; `raised` shadow is 6% opacity max. Dark theme uses surface contrast, not shadows.

## 4. Status taxonomy (`statusSemantics`)

| Status | Tone | Icon | Where |
|---|---|---|---|
| `extracted` | info | sparkles | AI-extracted, pending review |
| `needsReview` | warning | alert-triangle | confidence < floor |
| `corrected` | info | pencil | teacher-edited |
| `approved` | success | check-circle-2 | signed into the register |
| `rejected` | danger | x-circle | discarded read |
| `exported` | neutral | check | in an exported file |
| `duplicate` | warning | copy | same paper/page twice |
| `offline` | neutral | wifi-off | no network |
| `error` | danger | alert-circle | failure needing action |

Icons are mandatory — status is never communicated by color alone.

## 5. Theme support

- Preference: `system | light | dark`, chosen in Settings → Appearance, persisted with
  the other settings (encrypted, migrated safely via the defaults-spread parser).
- **Shipped now:** palettes, provider, tab bar + status bar + stack background theming.
- **Documented remaining work:** migrating legacy screens from `C.*` to `useTheme()`
  (mechanical, screen-by-screen); Storybook-free component previews are not planned.

## 6. Component inventory

Already existed (approved Stage 1 kit, `components/ui.tsx`): `Press` (press
micro-interaction), `Card`, `Btn` (primary/outline/amber/grey), `Chip`, `IconTile`,
`Avatar`, `Progress`, `StatusPill`, `ListRow`, `InfoRow`, `SearchField`, `ScreenHeader`,
`Logo`, `Illu` (empty-state illustrations).

Added in Stage 2 (`design-system/components.tsx`): `StatusBadge`, `ConfidenceIndicator`
(bands: ≥0.75 auto-fillable / 0.5–0.75 review / <0.5 manual, numeric score always
shown), `EmptyState` (icon + title + body + one action), `ErrorState` (retry, honest
detail text), `Skeleton`, `LoadingRow`, `ConfirmDialog` (required before destructive
actions; confirm button names the action).

Deliberately **not** duplicated: buttons, cards, chips, rows — reuse the existing kit.
A per-component catalog with APIs and usage guidance is in
`STAGE_2_COMPONENT_CATALOG.md`.
