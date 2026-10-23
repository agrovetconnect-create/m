# Stage 2 — Component Catalog
**AI Mark Enter System →** component APIs and when to use each variant. Two homes:
`components/ui.tsx` (Stage 1 approved kit — unchanged) and `src/design-system/`
(Stage 2 additions). All strings arrive as props (pre-translated) — components never
hardcode copy, so i18n ×5 parity is preserved automatically.

## A. Actions

| Component | Variants | Use when |
|---|---|---|
| `Btn` (ui) | `primary` (brand, filled), `outline` (brand border), `amber` (caution-advance), `grey` (secondary) | One primary action per view max; `outline` for alternatives; `amber` for "proceed despite warning"; `grey` for low-emphasis |
| `Press` (ui) | — | Any custom tappable; gives the 0.97 press scale + accessibility plumbing |
| IconButton | (compose `Press` + lucide icon, 44×44) | Icon-only actions **must** pass `accessibilityLabel` |

## B. Inputs

| Component | Notes |
|---|---|
| `SearchField` (ui) | Rounded search with icon; label required for a11y |
| Text field | Native `TextInput` on `fieldBg`, radius `m`, label always visible (no placeholder-only) |
| Select / Radio / Switch | Native `Picker` / `Press`+`accessibilityState` / RN `Switch` — no custom control unless a documented reason |
| Checkbox | Custom check row on `Press` with `accessibilityRole="checkbox"` + state |

## C. Status & feedback

| Component | API | Use when |
|---|---|---|
| `StatusBadge` (ds) | `status: StatusKey, label` | Review lifecycle + scanning exceptions; icon+color+text |
| `StatusPill` (ui) | `label, tint, fg, icon` | Small inline status in rows (legacy) |
| `ConfidenceIndicator` (ds) | `confidence, highLabel, reviewLabel, lowLabel` | Every recognition result row; bands 0.75 / 0.5 |
| `Progress` (ui) | `frac` | Session progress, sync queue |
| `Alert` | `ErrorState` for failures; inline amber cards for warnings | Banner-style notices |
| `Toast` | RN `Alert` / transient banner — no third-party toast lib | Non-blocking confirmations |
| `LoadingRow` (ds) | `label` | List footers |
| `Skeleton` (ds) | `width?, height?` | Compose into the screen's shape while loading |
| `EmptyState` (ds) | `icon, title, body?, actionLabel?, onAction?` | Zero-data states with one clear action |
| `ErrorState` (ds) | `title, detail?, retryLabel?, onRetry?` | Failures with recovery; `detail` sanitized |
| `ConfirmDialog` (ds) | `visible, title, body?, confirmLabel, cancelLabel, destructive` | **Required** before deleting approved marks / overwriting registers |

## D. Structure & data

| Component | Notes |
|---|---|
| `Card` (ui) | White (themed: `palette.card`) surface, radius 16, 1px `line` |
| `ListRow` / `InfoRow` (ui) | Settings-style rows; icon + label + value/chevron |
| `ScreenHeader` (ui) | Back/close + centered title — the one plain-screen header |
| Section header | `type.bodyStrong` on `ink` + optional trailing link; no card |
| Tabs / Table / Pagination | Mobile: segmented `Chip` row filters; tables render as stacked cards with column captions on narrow screens; full tables are a web/desktop layout concern (sidebar-nav shell, documented in screen specs) |
| `Chip` (ui) | Filters, segmented choices, `accessibilityState.selected` when active |
| File drop zone / import preview | Web-only (`live-camera.tsx` pattern); native uses system pickers; preview always shows parsed rows before confirm |
| Camera status panel / scanning indicator | Scan screen HUD (implemented Stage 1: quality, confidence, latency, paper bounds); states from the real engine only |

## E. Rules

1. One primary button per view; destructive actions are outline-danger inside
   `ConfirmDialog`, never a big red block next to safe actions.
2. Every interactive element: ≥44×44, `accessibilityLabel` when icon-only, visible focus
   on web.
3. Loading → skeleton shaped like the content; error → `ErrorState` with retry; empty →
   `EmptyState` with the action that creates the first item.
4. Numbers from the engine (confidence, counts, latency) are always shown numerically
   alongside any visual encoding.
5. No component fetches data or talks to engines — UI state stays separate from
   recognition/sync logic (props in, callbacks out).
