/**
 * xlsx-lite — a dependency-free .xlsx (Excel workbook) reader for React Native.
 *
 * .xlsx is a ZIP container holding XML sheets. This module implements the three
 * pieces needed to read one on-device without native modules (Expo Go):
 *   1. a raw DEFLATE decompressor (RFC 1951) for compressed ZIP members,
 *   2. a ZIP central-directory reader,
 *   3. a minimal spreadsheet-XML scanner (shared strings, workbook rels, cells).
 *
 * It never invents data: unreadable/foreign files throw XLSX_BAD_FORMAT so the
 * caller can tell the teacher the upload was not acceptable.
 */

// --- UTF-8 -----------------------------------------------------------------

/** Manual UTF-8 decode (Hermes does not guarantee TextDecoder). */
function utf8Decode(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b < 0x80) {
      out += String.fromCharCode(b);
      i += 1;
    } else if (b < 0xe0) {
      out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f));
      i += 2;
    } else if (b < 0xf0) {
      out += String.fromCharCode(
        ((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f),
      );
      i += 3;
    } else {
      const cp =
        ((b & 0x07) << 18) |
        ((bytes[i + 1] & 0x3f) << 12) |
        ((bytes[i + 2] & 0x3f) << 6) |
        (bytes[i + 3] & 0x3f);
      // Surrogate pair for astral plane characters.
      out += String.fromCharCode(0xd800 + ((cp - 0x10000) >> 10), 0xdc00 + ((cp - 0x10000) & 0x3ff));
      i += 4;
    }
  }
  return out;
}

// --- DEFLATE (RFC 1951) ----------------------------------------------------

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CLEN_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

class BitReader {
  private buf: Uint8Array;
  private pos = 0;
  private bitBuf = 0;
  private bitCnt = 0;

  constructor(buf: Uint8Array) {
    this.buf = buf;
  }

  bits(need: number): number {
    if (need === 0) return 0; // no-op — must not clear buffered bits
    let val = this.bitBuf;
    while (this.bitCnt < need) {
      if (this.pos >= this.buf.length) throw new Error("XLSX_CORRUPT");
      val |= this.buf[this.pos++] << this.bitCnt;
      this.bitCnt += 8;
    }
    this.bitBuf = val >>> need;
    this.bitCnt -= need;
    return val & ((1 << need) - 1);
  }

  alignByte(): void {
    this.bitBuf = 0;
    this.bitCnt = 0;
  }
}

type Huff = { counts: number[]; symbols: number[] };

/** Canonical Huffman table from code lengths (puff-style counts/symbols). */
function construct(lengths: number[]): Huff {
  const counts = new Array<number>(16).fill(0);
  for (const len of lengths) if (len > 0) counts[len] += 1;
  const offs = new Array<number>(16).fill(0);
  for (let i = 1; i < 15; i++) offs[i + 1] = offs[i] + counts[i];
  const symbols = new Array<number>(lengths.filter((l) => l > 0).length);
  for (let sym = 0; sym < lengths.length; sym++) {
    if (lengths[sym] > 0) symbols[offs[lengths[sym]]++] = sym;
  }
  return { counts, symbols };
}

function decodeSym(br: BitReader, h: Huff): number {
  let code = 0;
  let first = 0;
  let index = 0;
  for (let len = 1; len <= 15; len++) {
    code |= br.bits(1);
    const count = h.counts[len];
    if (code - first < count) return h.symbols[index + (code - first)];
    index += count;
    first = (first + count) << 1;
    code <<= 1;
  }
  throw new Error("XLSX_CORRUPT");
}

let fixedLit: Huff | null = null;
let fixedDist: Huff | null = null;

function fixedTables(): { lit: Huff; dist: Huff } {
  if (!fixedLit || !fixedDist) {
    const litLens: number[] = [];
    for (let i = 0; i <= 143; i++) litLens.push(8);
    for (let i = 144; i <= 255; i++) litLens.push(9);
    for (let i = 256; i <= 279; i++) litLens.push(7);
    for (let i = 280; i <= 287; i++) litLens.push(8);
    fixedLit = construct(litLens);
    fixedDist = construct(new Array<number>(30).fill(5));
  }
  return { lit: fixedLit, dist: fixedDist };
}

/** Raw DEFLATE stream decompression with a hard output cap. */
export function inflateRaw(data: Uint8Array, maxOut = 32 * 1024 * 1024): Uint8Array {
  const br = new BitReader(data);
  let out = new Uint8Array(64 * 1024);
  let outLen = 0;
  const grow = (extra: number) => {
    if (outLen + extra <= out.length) return;
    let cap = out.length;
    while (cap < outLen + extra) cap *= 2;
    if (cap > maxOut) throw new Error("XLSX_CORRUPT");
    const next = new Uint8Array(cap);
    next.set(out.subarray(0, outLen));
    out = next;
  };
  const { lit: fLit, dist: fDist } = fixedTables();
  const lens = new Array<number>(320).fill(0);

  for (;;) {
    const isFinal = br.bits(1);
    const type = br.bits(2);
    if (type === 0) {
      // Stored block: skip to byte boundary, LEN/NLEN, raw copy.
      br.alignByte();
      const len = br.bits(16);
      const nlen = br.bits(16);
      if ((len ^ 0xffff) !== nlen) throw new Error("XLSX_CORRUPT");
      grow(len);
      for (let i = 0; i < len; i++) out[outLen++] = br.bits(8);
    } else if (type === 1 || type === 2) {
      let litH: Huff;
      let distH: Huff;
      if (type === 1) {
        litH = fLit;
        distH = fDist;
      } else {
        const hlit = br.bits(5) + 257;
        const hdist = br.bits(5) + 1;
        const hclen = br.bits(4) + 4;
        const clens = new Array<number>(19).fill(0);
        for (let i = 0; i < hclen; i++) clens[CLEN_ORDER[i]] = br.bits(3);
        const clH = construct(clens);
        let i = 0;
        while (i < hlit + hdist) {
          const sym = decodeSym(br, clH);
          if (sym < 16) {
            lens[i++] = sym;
          } else if (sym === 16) {
            if (i === 0) throw new Error("XLSX_CORRUPT");
            const prev = lens[i - 1];
            const rep = 3 + br.bits(2);
            for (let j = 0; j < rep; j++) lens[i++] = prev;
          } else if (sym === 17) {
            const rep = 3 + br.bits(3);
            for (let j = 0; j < rep; j++) lens[i++] = 0;
          } else {
            const rep = 11 + br.bits(7);
            for (let j = 0; j < rep; j++) lens[i++] = 0;
          }
        }
        if (lens[256] === 0) throw new Error("XLSX_CORRUPT");
        litH = construct(lens.slice(0, hlit));
        distH = construct(lens.slice(hlit, hlit + hdist));
      }
      for (;;) {
        const sym = decodeSym(br, litH);
        if (sym < 256) {
          grow(1);
          out[outLen++] = sym;
        } else if (sym === 256) {
          break;
        } else {
          const li = sym - 257;
          if (li >= LEN_BASE.length) throw new Error("XLSX_CORRUPT");
          const length = LEN_BASE[li] + br.bits(LEN_EXTRA[li]);
          const di = decodeSym(br, distH);
          if (di >= DIST_BASE.length) throw new Error("XLSX_CORRUPT");
          const dist = DIST_BASE[di] + br.bits(DIST_EXTRA[di]);
          if (dist > outLen) throw new Error("XLSX_CORRUPT");
          grow(length);
          let from = outLen - dist;
          for (let j = 0; j < length; j++) out[outLen++] = out[from++];
        }
      }
    } else {
      throw new Error("XLSX_CORRUPT");
    }
    if (isFinal) break;
  }
  return out.slice(0, outLen);
}

// --- Base64 ---------------------------------------------------------------

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Decode base64 (file reads come back as base64 strings on device). */
export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/=]/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  let buf = 0;
  let bits = 0;
  for (const ch of clean) {
    if (ch === "=") break;
    const v = B64.indexOf(ch);
    if (v < 0) continue;
    buf = ((buf << 6) | v) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buf >> bits) & 0xff;
    }
  }
  return out.subarray(0, o);
}

// --- ZIP -------------------------------------------------------------------

type ZipEntry = { name: string; method: number; compSize: number; dataStart: number };

function u16(b: Uint8Array, i: number): number {
  return b[i] | (b[i + 1] << 8);
}
function u32(b: Uint8Array, i: number): number {
  return (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
}

function readZip(data: Uint8Array): Map<string, ZipEntry> {
  // Locate the End Of Central Directory record (scan back over any comment).
  let eocd = -1;
  const min = Math.max(0, data.length - 66_000);
  for (let i = data.length - 22; i >= min; i--) {
    if (u32(data, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("XLSX_BAD_FORMAT");

  const entries = new Map<string, ZipEntry>();
  let p = u32(data, eocd + 16);
  const count = u16(data, eocd + 10);
  for (let n = 0; n < count; n++) {
    if (u32(data, p) !== 0x02014b50) throw new Error("XLSX_BAD_FORMAT");
    const method = u16(data, p + 10);
    const compSize = u32(data, p + 20);
    const nameLen = u16(data, p + 28);
    const extraLen = u16(data, p + 30);
    const commentLen = u16(data, p + 32);
    const localOff = u32(data, p + 42);
    const name = utf8Decode(data.subarray(p + 46, p + 46 + nameLen));
    if (u32(data, localOff) === 0x04034b50) {
      const lNameLen = u16(data, localOff + 26);
      const lExtraLen = u16(data, localOff + 28);
      entries.set(name, { name, method, compSize, dataStart: localOff + 30 + lNameLen + lExtraLen });
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function member(data: Uint8Array, zip: Map<string, ZipEntry>, name: string): string | null {
  const e = zip.get(name);
  if (!e) return null;
  const slice = data.subarray(e.dataStart, e.dataStart + e.compSize);
  let bytes: Uint8Array;
  if (e.method === 0) {
    bytes = slice;
  } else if (e.method === 8) {
    bytes = inflateRaw(slice);
  } else {
    throw new Error("XLSX_CORRUPT");
  }
  return utf8Decode(bytes);
}

// --- Minimal spreadsheet XML -----------------------------------------------

function unescapeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`${name}="([^"]*)"`));
  return m ? unescapeXml(m[1]) : null;
}

/** "BC12" → column index (A=0). */
export function colToIndex(col: string): number {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Shared string table: every <si> joins its <t> runs. */
function parseSharedStrings(xml: string): string[] {
  const list: string[] = [];
  const siRe = /<si(?:\s[^>]*)?>([\s\S]*?)<\/si>|<si(?:\s[^>]*)?\/>/g;
  let m: RegExpExecArray | null;
  while ((m = siRe.exec(xml))) {
    if (!m[1]) {
      list.push("");
      continue;
    }
    let text = "";
    const tRe = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g;
    let t: RegExpExecArray | null;
    while ((t = tRe.exec(m[1]))) text += t[1] ?? "";
    list.push(unescapeXml(text));
  }
  return list;
}

type Cell = { col: number; value: string };

function parseCells(rowXml: string, shared: string[]): Cell[] {
  const cells: Cell[] = [];
  const cRe = /<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let c: RegExpExecArray | null;
  while ((c = cRe.exec(rowXml))) {
    const head = c[1];
    const body = c[2] ?? "";
    const r = attr(head, "r");
    if (!r) continue;
    const colMatch = r.match(/^([A-Z]+)/);
    if (!colMatch) continue;
    const col = colToIndex(colMatch[1]);
    const type = attr(head, "t") ?? "n";
    let value = "";
    if (type === "inlineStr") {
      const isBody = body.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/);
      value = isBody ? unescapeXml(isBody[1]) : "";
    } else {
      const v = body.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/);
      if (!v) continue;
      value = type === "s" ? (shared[parseInt(v[1], 10)] ?? "") : unescapeXml(v[1]);
      if (type === "b") value = v[1] === "1" ? "TRUE" : "FALSE";
    }
    cells.push({ col, value });
  }
  return cells;
}

function parseSheet(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  const rowRe = /<row\s([^>]*?)>([\s\S]*?)<\/row>/g;
  let r: RegExpExecArray | null;
  while ((r = rowRe.exec(xml))) {
    const cells = parseCells(r[2], shared);
    if (cells.length === 0) continue;
    let width = 0;
    for (const c of cells) width = Math.max(width, c.col + 1);
    const line = new Array<string>(width).fill("");
    for (const c of cells) line[c.col] = c.value;
    rows.push(line);
  }
  return rows;
}

/** Sheet names in workbook order, mapped to their XML targets via rels. */
function sheetTargets(workbook: string, rels: string | null): { name: string; target: string }[] {
  const relMap = new Map<string, string>();
  if (rels) {
    const relRe = /<Relationship\s([^>]*?)\/?>/g;
    let m: RegExpExecArray | null;
    while ((m = relRe.exec(rels))) {
      const id = attr(m[1], "Id");
      const target = attr(m[1], "Target");
      if (id && target) relMap.set(id, target);
    }
  }
  const out: { name: string; target: string }[] = [];
  const sheetRe = /<sheet\s([^>]*?)\/?>/g;
  let s: RegExpExecArray | null;
  while ((s = sheetRe.exec(workbook))) {
    const name = attr(s[1], "name");
    const rid = attr(s[1], "r:id") ?? attr(s[1], "id");
    const fallback = `worksheets/sheet${out.length + 1}.xml`;
    let target = (rid && relMap.get(rid)) || fallback;
    target = target.replace(/^\/xl\//, "").replace(/^\//, "").replace(/^xl\//, "");
    if (name) out.push({ name, target: `xl/${target}` });
  }
  return out;
}

// --- Public API ------------------------------------------------------------

export type XlsxTable = { name: string; rows: string[][] };

/**
 * Parse an .xlsx workbook into named sheets of string rows.
 * Throws `XLSX_BAD_FORMAT` for non-xlsx input and `XLSX_CORRUPT` for damaged
 * containers — callers surface both as "file not acceptable" notices.
 */
export function readXlsx(data: Uint8Array): XlsxTable[] {
  if (data.length < 22) throw new Error("XLSX_BAD_FORMAT");
  // XLSX always starts with the ZIP local-header signature "PK".
  if (data[0] !== 0x50 || data[1] !== 0x4b) throw new Error("XLSX_BAD_FORMAT");

  const zip = readZip(data);
  const workbook = member(data, zip, "xl/workbook.xml");
  if (!workbook) throw new Error("XLSX_BAD_FORMAT");
  const rels = member(data, zip, "xl/_rels/workbook.xml.rels");
  const sharedXml = member(data, zip, "xl/sharedStrings.xml");
  const shared = sharedXml ? parseSharedStrings(sharedXml) : [];

  const tables: XlsxTable[] = [];
  for (const { name, target } of sheetTargets(workbook, rels)) {
    const xml = member(data, zip, target);
    if (!xml) continue;
    const rows = parseSheet(xml, shared);
    tables.push({ name, rows });
  }
  if (tables.length === 0) throw new Error("XLSX_BAD_FORMAT");
  return tables;
}
