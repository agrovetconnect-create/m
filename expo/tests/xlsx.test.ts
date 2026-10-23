import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { colToIndex, readXlsx } from "../lib/vendor/xlsx-lite";

const fixture = new Uint8Array(readFileSync(new URL("./fixtures/sample.xlsx", import.meta.url)));

describe("xlsx-lite (real .xlsx workbook)", () => {
  test("rejects non-zip input as a bad format", () => {
    const notZip = new Uint8Array(new TextEncoder().encode("student,name\nAmina,S001"));
    expect(() => readXlsx(notZip)).toThrow("XLSX_BAD_FORMAT");
  });

  test("reads sheet names in workbook order via rels", () => {
    const sheets = readXlsx(fixture);
    expect(sheets.map((s) => s.name)).toEqual(["Class List", "Numbers"]);
  });

  test("resolves shared strings, inline strings and numbers", () => {
    const sheets = readXlsx(fixture);
    const rows = sheets[0].rows;
    expect(rows[0]).toEqual(["Name", "Student ID"]);
    expect(rows[1]).toEqual(["Amina Yusuf", "S001"]);
    expect(rows[5]).toEqual(["Grace Wanjiku", "S005"]);
    expect(sheets[1].rows).toEqual([["42"], ["1.5"]]);
  });

  test("column letters map to zero-based indexes", () => {
    expect(colToIndex("A")).toBe(0);
    expect(colToIndex("Z")).toBe(25);
    expect(colToIndex("AA")).toBe(26);
  });
});
