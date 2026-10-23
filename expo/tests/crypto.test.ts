import { test, expect } from "bun:test";
import { hmacSha256, encryptString, decryptString, uuid4, getOrCreateKey } from "../lib/crypto";

const strBytes = (s: string): number[] => Array.from(new TextEncoder().encode(s));
const hex = (b: number[]): string => b.map((x) => x.toString(16).padStart(2, "0")).join("");

test("hmac-sha256 matches known vectors", () => {
  expect(hex(hmacSha256(strBytes("key"), strBytes("The quick brown fox jumps over the lazy dog")))).toBe(
    "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8",
  );
  expect(hex(hmacSha256(strBytes("Jefe"), strBytes("what do ya want for nothing?")))).toBe(
    "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
  );
});

test("hmac-sha256 matches RFC 4231 case 6 (key larger than block size)", () => {
  const longKey = Array.from({ length: 131 }, () => 0xaa);
  expect(hex(hmacSha256(longKey, strBytes("Test Using Larger Than Block-Size Key - Hash Key First")))).toBe(
    "60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54",
  );
});

test("aes-256 roundtrip preserves unicode text", () => {
  const key = Array.from({ length: 32 }, (_, i) => i);
  const plain = "Dana Whitfield — العربية 82/100 ✓";
  expect(decryptString(key, encryptString(key, plain))).toBe(plain);
});

test("different IVs produce different ciphertexts for the same plaintext", () => {
  const key = Array.from({ length: 32 }, (_, i) => i);
  expect(encryptString(key, "same")).not.toBe(encryptString(key, "same"));
});

test("uuid4 shape and uniqueness", () => {
  const ids = new Set<string>();
  for (let i = 0; i < 500; i++) {
    const id = uuid4();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    ids.add(id);
  }
  expect(ids.size).toBe(500);
});

test("getOrCreateKey persists the same key across calls", async () => {
  const a = await getOrCreateKey();
  const b = await getOrCreateKey();
  expect(a).toEqual(b);
  expect(a).toHaveLength(32);
});
