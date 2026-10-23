/**
 * Stage 2 color palettes. `light` maps onto the approved mockup palette (the
 * legacy `C` object) — values are identical, only the naming is semantic.
 * `dark` is the Stage 2 dark counterpart: same hue family, inverted surfaces,
 * status colors retuned for dark-ground contrast.
 *
 * Contrast contract (asserted by tests/design-system.test.ts): text on its
 * background ≥ 4.5:1; large/bold text ≥ 3:1; borders ≥ 3:1 against card.
 */

export type Palette = { readonly [K in keyof typeof lightPalette]: string };

export const lightPalette = {
  // Surfaces
  bg: "#F0F3EF",
  card: "#FFFFFF",
  fieldBg: "#F4F6F3",
  chip: "#EDF1EC",
  row: "#F1F4F0",
  // Text
  ink: "#1F261F",
  sub: "#5E6B62",
  faint: "#98A39A",
  // Lines
  line: "#E5EAE4",
  hairline: "#EFF2EE",
  // Brand
  brand: "#1B5E3B",
  brandDeep: "#14472C",
  brandTint: "#E7EFE6",
  brandChip: "#DFEBDD",
  onBrand: "#FFFFFF",
  // Status
  success: "#1B5E3B",
  successBg: "#DFF0E0",
  warning: "#8A560B",
  warningBg: "#FBF2DA",
  danger: "#B23227",
  dangerBg: "#FBEAE8",
  info: "#2B5D8A",
  infoBg: "#E3EDF6",
  neutral: "#5E6B62",
  neutralBg: "#EDF1EC",
  // Misc
  track: "#E2E8E1",
  trackOff: "#D6DCD5",
  scrim: "rgba(15, 31, 21, 0.45)",
} as const;

export const darkPalette = {
  // Surfaces
  bg: "#0E1712",
  card: "#17231B",
  fieldBg: "#1D2A21",
  chip: "#223027",
  row: "#1A2620",
  // Text
  ink: "#E8F0E8",
  sub: "#9FADA2",
  faint: "#6E7C72",
  // Lines
  line: "#2A3A2F",
  hairline: "#243028",
  // Brand
  brand: "#5FBF8A",
  brandDeep: "#7BD3A3",
  brandTint: "#1C3527",
  brandChip: "#23402F",
  onBrand: "#0B1F15",
  // Status (retuned for ≥4.5:1 on card #17231B)
  success: "#7BD3A3",
  successBg: "#1C3527",
  warning: "#E8B45A",
  warningBg: "#3A2F14",
  danger: "#F08A7E",
  dangerBg: "#3B1F1C",
  info: "#7FB6E0",
  infoBg: "#1A2C3D",
  neutral: "#9FADA2",
  neutralBg: "#223027",
  // Misc
  track: "#2A3A2F",
  trackOff: "#3A4A3F",
  scrim: "rgba(0, 0, 0, 0.6)",
} as const;
