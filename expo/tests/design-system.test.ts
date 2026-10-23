import { describe, expect, test } from "bun:test";
import { darkPalette, lightPalette, type Palette } from "../src/design-system/palettes";
import { normalizePreference, resolveTheme } from "../src/design-system/resolve";
import {
  breakpointOf,
  radius,
  spacing,
  statusSemantics,
  TOUCH_TARGET,
  type StatusKey,
} from "../src/design-system/tokens";

/**
 * Stage 2 design-system tests. The contrast assertions are the objective part
 * of the accessibility contract: they measure actual WCAG 2.x ratios for the
 * token pairs every screen relies on, in both themes.
 */

/** Parse #RRGGBB into linear-lightness per WCAG 2.x relative luminance. */
function luminance(hex: string): number {
  const n = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(n)) throw new Error(`unsupported hex: ${hex}`);
  const chan = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255);
  const [r, g, b] = chan.map((c) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4),
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fgHex: string, bgHex: string): number {
  const l1 = luminance(fgHex);
  const l2 = luminance(bgHex);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

describe("design tokens", () => {
  test("spacing scale is monotonic", () => {
    const vals = Object.values(spacing);
    for (let i = 1; i < vals.length; i++) expect(vals[i]).toBeGreaterThan(vals[i - 1]);
  });

  test("radius scale is monotonic", () => {
    const vals = Object.values(radius);
    for (let i = 1; i < vals.length; i++) expect(vals[i]).toBeGreaterThan(vals[i - 1]);
  });

  test("touch target meets the 44pt accessibility minimum", () => {
    expect(TOUCH_TARGET).toBeGreaterThanOrEqual(44);
  });

  test("breakpoints resolve in order", () => {
    expect(breakpointOf(375)).toBe("phone");
    expect(breakpointOf(768)).toBe("tablet");
    expect(breakpointOf(1024)).toBe("desktop");
    expect(breakpointOf(1440)).toBe("wide");
  });

  test("every status has a tone and an icon (status is never color-only)", () => {
    const statuses = Object.keys(statusSemantics) as StatusKey[];
    expect(statuses.length).toBeGreaterThanOrEqual(9);
    for (const s of statuses) {
      expect(statusSemantics[s].icon.length).toBeGreaterThan(0);
      expect(["success", "warning", "danger", "info", "neutral"]).toContain(
        statusSemantics[s].tone,
      );
    }
  });
});

describe("theme resolution", () => {
  test("light and dark palettes resolve from the preference", () => {
    expect(resolveTheme("light", "dark").isDark).toBe(false);
    expect(resolveTheme("dark", "light").isDark).toBe(true);
    expect(resolveTheme("system", "dark").isDark).toBe(true);
    expect(resolveTheme("system", null).isDark).toBe(false);
  });

  test("normalizePreference maps unknown/legacy values to system", () => {
    expect(normalizePreference("dark")).toBe("dark");
    expect(normalizePreference("light")).toBe("light");
    expect(normalizePreference("system")).toBe("system");
    expect(normalizePreference(undefined)).toBe("system");
    expect(normalizePreference("hotdog")).toBe("system");
  });

  test("both palettes expose the identical token shape", () => {
    expect(Object.keys(lightPalette).sort()).toEqual(Object.keys(darkPalette).sort());
  });
});

const TEXT_PAIRS: Array<[keyof Palette, keyof Palette]> = [
  ["ink", "bg"],
  ["ink", "card"],
  ["sub", "bg"],
  ["sub", "card"],
  ["brand", "bg"],
  ["success", "successBg"],
  ["warning", "warningBg"],
  ["danger", "dangerBg"],
  ["info", "infoBg"],
  ["neutral", "neutralBg"],
];

describe("WCAG contrast (AA, measured — both themes)", () => {
  for (const [name, palette] of [
    ["light", lightPalette],
    ["dark", darkPalette],
  ] as const) {
    test(`${name}: body text ≥ 4.5:1 on its surfaces`, () => {
      for (const [fg, bg] of TEXT_PAIRS) {
        const ratio = contrast(palette[fg] as string, palette[bg] as string);
        if (ratio < 4.5) throw new Error(`${fg} on ${bg} is ${ratio.toFixed(2)}:1 (< 4.5)`);
        expect(ratio).toBeGreaterThanOrEqual(4.5);
      }
    });

    test(`${name}: brand-on-brand text ≥ 4.5:1`, () => {
      expect(contrast(palette.onBrand as string, palette.brand as string)).toBeGreaterThanOrEqual(4.5);
    });
  }
});
