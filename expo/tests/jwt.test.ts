import { expect, test } from "bun:test";
import { jwtExpiresAt } from "../lib/supabase";

const b64url = (s: string): string =>
  btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

test("jwtExpiresAt decodes the exp claim (url-safe alphabet, no padding)", () => {
  const token = `eyJhbGciOiJIUzI1NiJ9.${b64url(JSON.stringify({ exp: 2000000000, sub: "x" }))}.sig`;
  expect(jwtExpiresAt(token)).toBe(2000000000);
});

test("jwtExpiresAt returns 0 for tokens without exp or with garbage segments", () => {
  expect(jwtExpiresAt(`a.${b64url(JSON.stringify({ sub: "x" }))}.b`)).toBe(0);
  expect(jwtExpiresAt("not-a-jwt")).toBe(0);
  expect(jwtExpiresAt("")).toBe(0);
});
