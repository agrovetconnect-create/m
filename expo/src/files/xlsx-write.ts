/**
 * xlsx-write — a dependency-free .xlsx (Excel workbook) writer, the counterpart
 * to lib/vendor/xlsx-lite's reader. Like the reader it never invents data: it
 * produces a minimal, standards-valid OOXML workbook that the real Excel format
 * accepts and that xlsx-lite can read back byte-for-byte semantically.
 *
 * All ZIP members are written STORED (method 0, no compression): .xlsx readers
 * are required to accept stored entries, and a DEFLATE *compressor* would add
 * hundreds of lines for zero correctness benefit. CRC-32 is real — integrity
 * matters more than file size for a teacher's registers.
 */

// --- UTF-8 encode (Hermes does not guarantee TextEncoder) -------------------

function utf8Encode(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let cp = s.codePointAt(i)!;
    if (cp > 0xffff) i += 1; // surrogate pair consumed as one code point
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000)
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
  }
  return new Uint8Array(out);
}

// --- Base64 (for file writes that accept base64 payloads) -------------------

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function bytesToBase64(bytes: Uint8Array): string {
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

// --- CRC-32 (IEEE, reflected 0xEDB88320) ------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// --- ZIP assembly (STORED members only) -------------------------------------

class ByteWriter {
  private chunks: Uint8Array[] = [];
  private len = 0;
  push(b: Uint8Array): void {
    this.chunks.push(b);
    this.len += b.length;
  }
  get length(): number {
    return this.len;
  }
  done(): Uint8Array {
    const out = new Uint8Array(this.len);
    let o = 0;
    for (const c of this.chunks) {
      out.set(c, o);
      o += c.length;
    }
    return out;
  }
}

function u16le(v: number): Uint8Array {
  return new Uint8Array([v & 0xff, (v >> 8) & 0xff]);
}
function u32le(v: number): Uint8Array {
  return new Uint8Array([v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff]);
}

type Member = { name: string; data: Uint8Array; crc: number; offset: number };

function zipStore(members: Member[]): Uint8Array {
  const out = new ByteWriter();
  const central = new ByteWriter();
  for (const m of members) {
    m.offset = out.length;
    out.push(u32le(0x04034b50)); // local file header
    out.push(u16le(20)); // version needed
    out.push(u16le(0)); // flags
    out.push(u16le(0)); // method: stored
    out.push(u16le(0)); // mod time
    out.push(u16le(0)); // mod date
    out.push(u32le(m.crc));
    out.push(u32le(m.data.length));
    out.push(u32le(m.data.length));
    const name = utf8Encode(m.name);
    out.push(u16le(name.length));
    out.push(u16le(0)); // extra len
    out.push(name);
    out.push(m.data);
  }
  const cdStart = out.length;
  for (const m of members) {
    central.push(u32le(0x02014b50)); // central directory header
    central.push(u16le(20)); // version made by
    central.push(u16le(20)); // version needed
    central.push(u16le(0)); // flags
    central.push(u16le(0)); // method
    central.push(u16le(0)); // time
    central.push(u16le(0)); // date
    central.push(u32le(m.crc));
    central.push(u32le(m.data.length));
    central.push(u32le(m.data.length));
    const name = utf8Encode(m.name);
    central.push(u16le(name.length));
    central.push(u16le(0)); // extra
    central.push(u16le(0)); // comment
    central.push(u16le(0)); // disk start
    central.push(u16le(0)); // internal attrs
    central.push(u32le(0)); // external attrs
    central.push(u32le(m.offset));
    central.push(name);
  }
  const cd = central.done();
  out.push(cd);
  out.push(u32le(0x06054b50)); // end of central directory
  out.push(u16le(0));
  out.push(u16le(0));
  out.push(u16le(members.length));
  out.push(u16le(members.length));
  out.push(u32le(cd.length));
  out.push(u32le(cdStart));
  out.push(u16le(0));
  return out.done();
}

// --- Minimal OOXML generation ------------------------------------------------

function escXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 0 → "A", 25 → "Z", 26 → "AA" (inverse of the reader's colToIndex). */
export function colName(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const FORMULA_CHARS = new Set(["=", "+", "-", "@"]);

/**
 * Export sanitization for untrusted text: spreadsheet applications interpret a
 * leading = + - @ as a formula. Such text cells are prefixed with an apostrophe
 * (a visible, reversible marker) instead of being executed or dropped. Legit
 * numeric marks travel as real numbers and are never touched. The CSV writer
 * applies the same rule.
 */
export function sanitizeCellText(s: string): string {
  return s.length > 0 && FORMULA_CHARS.has(s[0]) ? `'${s}` : s;
}

/**
 * Text cells are written verbatim — a register number like "0042" must never
 * be coerced to the number 42. Only actual JS numbers become numeric cells.
 */
function sheetXml(rows: (string | number)[][]): string {
  const rowXml = rows
    .map((cells, r) => {
      const cXml = cells
        .map((v, c) => {
          const ref = `${colName(c)}${r + 1}`;
          if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`;
          const s = String(v);
          if (s === "") return "";
          const safe = sanitizeCellText(s);
          const space = safe.trim() !== safe ? ' xml:space="preserve"' : "";
          return `<c r="${ref}" t="inlineStr"><is><t${space}>${escXml(safe)}</t></is></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cXml}</row>`;
    })
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetData>${rowXml}</sheetData></worksheet>`
  );
}

// --- Public API --------------------------------------------------------------

export type XlsxSheet = { name: string; rows: (string | number)[][] };

/**
 * Build a real .xlsx workbook from named sheets. Sheet names are sanitized to
 * Excel's rules (no : \ / ? * [ ], 31 chars max, unique). Throws XLSX_BAD_SHEET
 * when a name sanitizes to empty — callers surface that as "file not produced".
 */
export function writeXlsx(sheets: XlsxSheet[]): Uint8Array {
  if (sheets.length === 0) throw new Error("XLSX_BAD_SHEET");

  const seen = new Set<string>();
  const safeNames = sheets.map(({ name }) => {
    let clean = name.replace(/[:\\/?*[\]]/g, " ").trim().slice(0, 31);
    if (!clean) throw new Error("XLSX_BAD_SHEET");
    let candidate = clean;
    let n = 2;
    while (seen.has(candidate)) candidate = `${clean.slice(0, 29)}_${n++}`;
    seen.add(candidate);
    return candidate;
  });

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    sheets
      .map(
        (_, i) =>
          `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      )
      .join("") +
    `</Types>`;

  const rootRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`;

  const workbook =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets>` +
    safeNames
      .map(
        (name, i) =>
          `<sheet name="${escXml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
      )
      .join("") +
    `</sheets></workbook>`;

  const workbookRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    safeNames
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
      )
      .join("") +
    `</Relationships>`;

  const members: Member[] = [];
  const add = (name: string, xml: string) =>
    members.push({
      name,
      data: utf8Encode(xml),
      crc: crc32(utf8Encode(xml)),
      offset: 0,
    });
  add("[Content_Types].xml", contentTypes);
  add("_rels/.rels", rootRels);
  add("xl/workbook.xml", workbook);
  add("xl/_rels/workbook.xml.rels", workbookRels);
  sheets.forEach((sheet, i) => add(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(sheet.rows)));

  return zipStore(members);
}
