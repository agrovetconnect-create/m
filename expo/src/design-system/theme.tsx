import createContextHook from "@nkzw/create-context-hook";
import React, { useMemo } from "react";
import { useColorScheme } from "react-native";
import { useStore } from "@/lib/store";
import { darkPalette, lightPalette, type Palette } from "./palettes";
import { normalizePreference, resolveTheme, type ThemePreference } from "./resolve";

/**
 * Stage 2 theme architecture.
 *
 * The teacher's pick lives on the encrypted settings record (`settings.theme`),
 * so it persists with everything else and needs no extra storage path. Screens
 * read colors exclusively through `useTheme()` — never hardcode a hex outside
 * `palettes.ts`.
 *
 * Scope note (honest): palette + provider + the app shell (tab bar, status
 * bar) are themed now; migrating every legacy screen from the flat `C` object
 * to `useTheme()` is documented as remaining work in the Stage 2 completion
 * report.
 */
export type Theme = {
  /** Raw preference as chosen by the teacher. */
  preference: ThemePreference;
  /** Palette actually resolved after applying the system preference. */
  palette: Palette;
  isDark: boolean;
  setPreference: (p: ThemePreference) => void;
};

export const [ThemeProvider, useTheme] = createContextHook((): Theme => {
  const { settings, setSettings } = useStore();
  const preference = normalizePreference(settings.theme);
  const systemScheme = useColorScheme();
  const { palette, isDark } = useMemo(
    () => resolveTheme(preference, systemScheme),
    [preference, systemScheme],
  );
  return {
    preference,
    palette,
    isDark,
    setPreference: (p: ThemePreference) => setSettings((s: typeof settings) => ({ ...s, theme: p })),
  };
});

export { darkPalette, lightPalette, normalizePreference, resolveTheme };
export type { Palette, ThemePreference };
