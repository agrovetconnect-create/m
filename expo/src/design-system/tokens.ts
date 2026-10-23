/**
 * Stage 2 design tokens — the single source of truth for scales that are
 * theme-independent (spacing, radii, type, breakpoints, icon sizes, elevation).
 *
 * Color lives in `palettes.ts` (light + dark) and is consumed through
 * `useTheme()`; nothing here hardcodes a color. The legacy flat `C` object in
 * `components/ui.tsx` remains the light palette's origin — `lightPalette` maps
 * token names onto those exact approved values so existing screens keep
 * rendering identically during the incremental migration.
 */

/** 4-pt base grid; screens pick the nearest step instead of ad-hoc numbers. */
export const spacing = {
  xs: 4,
  s: 8,
  m: 12,
  l: 16,
  xl: 20,
  xxl: 28,
  xxxl: 40,
} as const;

/** Corner radii — pills/buttons use the largest step, cards the medium ones. */
export const radius = {
  s: 8,
  m: 14,
  l: 16,
  pill: 28,
} as const;

/**
 * Typography scale. Sizes are the ones already in use across the approved
 * screens; weights are limited to four to keep the type system restrained.
 */
export const type = {
  caption: { fontSize: 12, fontWeight: "600" as const },
  body: { fontSize: 15.5, fontWeight: "400" as const },
  bodyStrong: { fontSize: 16, fontWeight: "600" as const },
  title: { fontSize: 20, fontWeight: "800" as const },
  display: { fontSize: 26, fontWeight: "800" as const },
} as const;

/** Minimum touch target per platform accessibility guidance. */
export const TOUCH_TARGET = 44;

/** Width breakpoints for the widest layouts (web/desktop; RN `useWindowDimensions`). */
export const breakpoints = {
  /** Narrow phone in portrait — single column. */
  phone: 0,
  /** Large phone / small tablet — comfortable single column, wider gutters. */
  tablet: 600,
  /** Tablet landscape / web side panel appears. */
  desktop: 900,
  /** Wide desktop — centered content column, sidebar navigation. */
  wide: 1200,
} as const;

export type Breakpoint = keyof typeof breakpoints;

/** Resolve the current breakpoint name from a window width. */
export function breakpointOf(width: number): Breakpoint {
  if (width >= breakpoints.wide) return "wide";
  if (width >= breakpoints.desktop) return "desktop";
  if (width >= breakpoints.tablet) return "tablet";
  return "phone";
}

/** Standard icon sizes (lucide `size` prop). */
export const iconSize = {
  s: 16,
  m: 20,
  l: 24,
} as const;

/** Elevation levels — the design language is border-led; shadows stay subtle. */
export const elevation = {
  flat: { shadowOpacity: 0, elevation: 0 },
  raised: {
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
} as const;

/**
 * Semantic status taxonomy shared by every surface (badges, review rows,
 * scanning indicators). `icon` is mandatory: status is never color-only.
 */
export const statusSemantics = {
  extracted: { tone: "info", icon: "sparkles" },
  needsReview: { tone: "warning", icon: "alert-triangle" },
  corrected: { tone: "info", icon: "pencil" },
  approved: { tone: "success", icon: "check-circle-2" },
  rejected: { tone: "danger", icon: "x-circle" },
  exported: { tone: "neutral", icon: "check" },
  duplicate: { tone: "warning", icon: "copy" },
  offline: { tone: "neutral", icon: "wifi-off" },
  error: { tone: "danger", icon: "alert-circle" },
} as const;

export type StatusKey = keyof typeof statusSemantics;
export type StatusTone = (typeof statusSemantics)[StatusKey]["tone"];
