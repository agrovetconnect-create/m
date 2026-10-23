import { test, expect } from "bun:test";
import { dicts, LANGS } from "../lib/i18n";

const en = dicts.en;

test("all five languages ship the same key set", () => {
  for (const { code } of LANGS) {
    expect(Object.keys(dicts[code]).sort()).toEqual(Object.keys(en).sort());
  }
});

test("no empty translations", () => {
  for (const d of Object.values(dicts)) {
    for (const v of Object.values(d)) expect(v.trim().length).toBeGreaterThan(0);
  }
});

test("placeholder tokens match English for every key and language", () => {
  const ph = (s: string): string => (s.match(/\{[a-z]+\}/g) ?? []).sort().join(",");
  for (const [k, v] of Object.entries(en)) {
    for (const { code } of LANGS) {
      expect(`${code}:${k} → ${ph(dicts[code][k])}`).toBe(`${code}:${k} → ${ph(v)}`);
    }
  }
});
