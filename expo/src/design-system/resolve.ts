import { darkPalette, lightPalette, type Palette } from "./palettes";

/**
 * Pure theme logic (no react-native imports) so it is testable under bun and
 * reusable on web. The provider in `theme.tsx` wires it to the OS appearance.
 */
export type ThemePreference = "system" | "light" | "dark";

/** Resolve a preference to a palette; `system` follows the OS setting. */
export function resolveTheme(
  preference: ThemePreference,
  systemScheme: string | null | undefined,
): { palette: Palette; isDark: boolean } {
  const isDark = preference === "system" ? systemScheme === "dark" : preference === "dark";
  return { palette: isDark ? darkPalette : lightPalette, isDark };
}

/** Normalize unknown/legacy persisted values to a valid preference. */
export function normalizePreference(value: unknown): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}
