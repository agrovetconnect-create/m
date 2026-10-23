import AsyncStorage from "@react-native-async-storage/async-storage";
import aesjs from "./vendor/aes-js";

/**
 * Encryption at rest + record signing. Records are encrypted with AES-256-CTR
 * before being written to device storage, and every record carries a keyed
 * HMAC-SHA256 signature so tampering with stored data is detectable.
 *
 * Entropy note: Expo Go blocks expo-crypto / expo-secure-store, so random
 * bytes come from a timing-churned pool hashed through SHA-256 (stronger than
 * raw Math.random, but not hardware-backed). A dev build swaps this for
 * expo-crypto.getRandomValues + Keychain — the call sites won't change.
 */

const KEY_STORE = "marks.key.v1";
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// ---------------------------------------------------------------------------
// SHA-256 (FIPS 180-4), pure JS — deterministic across devices/JS engines.
// ---------------------------------------------------------------------------

const SHA_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

const rotr = (x: number, n: number): number => ((x >>> n) | (x << (32 - n))) >>> 0;

function sha256Bytes(msg: number[]): number[] {
  const len = msg.length;
  const padded = msg.slice();
  padded.push(0x80);
  while (padded.length % 64 !== 56) padded.push(0);
  const bitLen = len * 8;
  padded.push(0, 0, 0, 0, (bitLen >>> 24) & 0xff, (bitLen >>> 16) & 0xff, (bitLen >>> 8) & 0xff, bitLen & 0xff);

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Array<number>(64);

  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) {
      const j = off + 4 * i;
      w[i] = ((padded[j] << 24) | (padded[j + 1] << 16) | (padded[j + 2] << 8) | padded[j + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + SHA_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].flatMap((x) => [(x >>> 24) & 255, (x >>> 16) & 255, (x >>> 8) & 255, x & 255]);
}

/** HMAC-SHA256 — used for record signatures (no weak hash concatenation). */
export function hmacSha256(secret: number[], message: number[]): number[] {
  const BLOCK = 64;
  let key = secret.slice();
  if (key.length > BLOCK) key = sha256Bytes(key);
  while (key.length < BLOCK) key.push(0);
  const oKey = key.map((b) => b ^ 0x5c);
  const iKey = key.map((b) => b ^ 0x36);
  return sha256Bytes([...oKey, ...sha256Bytes([...iKey, ...message])]);
}

/**
 * Keyed signature for a record payload. The secret is derived from the device
 * encryption key, so a signature can only be produced by this device's data
 * store — editing a stored record without re-signing breaks verification.
 */
export function signPayload(secret: number[], payload: string): string {
  return hmacSha256(secret, utf8ToBytes(payload))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Derives the signing secret from the master key (nothing extra to store). */
export function deriveSigningKey(masterKey: number[]): number[] {
  return sha256Bytes([...masterKey, ...utf8ToBytes("marks.sign.v1")]);
}

// ---------------------------------------------------------------------------
// Entropy pool: timing + Math.random churned through SHA-256 (see header note).
// ---------------------------------------------------------------------------

let pool: number[] = [];

function churn(): number[] {
  const now = Date.now();
  const seeds: number[] = [now & 0xff, (now >> 8) & 0xff, (now >> 16) & 0xff, (now >> 24) & 0xff];
  for (let i = 0; i < 16; i++) seeds.push(Math.floor(Math.random() * 256));
  pool = sha256Bytes([...pool, ...seeds]);
  return pool.slice();
}

/** Random bytes for IVs, keys and IDs (prototype-grade entropy, see header). */
export function randomBytes(n: number): number[] {
  const out: number[] = [];
  while (out.length < n) out.push(...churn());
  return out.slice(0, n);
}

// ---------------------------------------------------------------------------
// Base64 + UTF-8 helpers (kept local: React Native has no atob for arrays).
// ---------------------------------------------------------------------------

function b64Encode(bytes: number[]): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)];
    out += b1 === undefined ? "=" : B64[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === undefined ? "=" : B64[b2 & 63];
  }
  return out;
}

function b64Decode(s: string): number[] {
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of s) {
    if (ch === "=") break;
    const v = B64.indexOf(ch);
    if (v < 0) continue;
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return out;
}

function utf8ToBytes(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      c = 0x10000 + ((c - 0xd800) << 10) + (s.charCodeAt(++i) - 0xdc00);
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

function bytesToUtf8(b: number[]): string {
  let out = "";
  for (let i = 0; i < b.length; ) {
    const c = b[i++];
    if (c < 0x80) out += String.fromCharCode(c);
    else if (c < 0xe0) out += String.fromCharCode(((c & 31) << 6) | (b[i++] & 63));
    else if (c < 0xf0) {
      out += String.fromCharCode(((c & 15) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63));
    } else {
      const cp = ((c & 7) << 18) | ((b[i++] & 63) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63);
      const v = cp - 0x10000;
      out += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public API (unchanged call sites)
// ---------------------------------------------------------------------------

/** Returns the persistent 32-byte device encryption key, creating it on first use. */
export async function getOrCreateKey(): Promise<number[]> {
  const stored = await AsyncStorage.getItem(KEY_STORE);
  if (stored) return b64Decode(stored);
  const key = randomBytes(32);
  await AsyncStorage.setItem(KEY_STORE, b64Encode(key));
  return key;
}

/** Encrypts a UTF-8 string to a base64 blob (IV prefixed). */
export function encryptString(key: number[], plain: string): string {
  const iv = randomBytes(16);
  const ctr = new aesjs.ModeOfOperation.ctr(key, new aesjs.Counter(iv));
  const enc: number[] = Array.from(ctr.encrypt(utf8ToBytes(plain)) as number[]);
  return b64Encode([...iv, ...enc]);
}

/** Decrypts a blob produced by encryptString. */
export function decryptString(key: number[], blob: string): string {
  const all = b64Decode(blob);
  const ctr = new aesjs.ModeOfOperation.ctr(key, new aesjs.Counter(all.slice(0, 16)));
  const dec = ctr.decrypt(all.slice(16));
  return bytesToUtf8(Array.from(dec));
}

/** Random UUID v4 (RFC 4122 shape) from the entropy pool. */
export function uuid4(): string {
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = b.map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
