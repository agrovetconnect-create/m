import { describe, expect, test } from "bun:test";
import { analyzeRoster, rebuildRoster } from "../lib/roster";

const sheet = (rows: string[][], name = "Sheet1") => ({ name, rows });

describe("roster detection (real spreadsheet analysis)", () => {
  test("finds header, name and ID columns from header text", () => {
    const a = analyzeRoster(sheet([["Student ID", "Full Name", "Class"], ["S001", "Amina Yusuf", "9A"], ["S002", "John Otieno", "9A"]]));
    expect(a.nameCol).toBe(1);
    expect(a.idCol).toBe(0);
    expect(a.students).toEqual([
      { name: "Amina Yusuf", ref: "S001" },
      { name: "John Otieno", ref: "S002" },
    ]);
    expect(a.missingName).toBe(0);
    expect(a.duplicates).toBe(0);
  });

  test("flags rows missing the required name", () => {
    const a = analyzeRoster(sheet([["Name", "ID"], ["Amina", "1"], ["", "2"], ["John", "3"]]));
    expect(a.missingName).toBe(1);
    expect(a.students.length).toBe(2);
  });

  test("skips fully empty padding rows", () => {
    const a = analyzeRoster(sheet([["Name"], ["Amina"], ["", ""], ["John"]]));
    expect(a.missingName).toBe(0);
    expect(a.students.length).toBe(2);
  });

  test("detects duplicate primary keys", () => {
    const a = analyzeRoster(sheet([["Name", "Reg No"], ["Amina", "S001"], ["John", "S001"]]));
    expect(a.duplicates).toBe(1);
  });

  test("falls back to cell shape when there is no header", () => {
    const a = analyzeRoster(sheet([["Alice Mwangi"], ["Bob Otieno"], ["Carol Hassan"]]));
    expect(a.nameCol).toBe(0);
    expect(a.idCol).toBeNull();
    expect(a.students.map((s) => s.name)).toEqual(["Alice Mwangi", "Bob Otieno", "Carol Hassan"]);
  });

  test("rebuild picks the teacher's reassigned columns", () => {
    const src = sheet([["Ref", "Student Name"], ["S001", "Amina"], ["S002", "John"]]);
    const a = analyzeRoster(src);
    expect(a.nameCol).toBe(1);
    const b = rebuildRoster(src, a, 0, 1);
    expect(b.students).toEqual([
      { name: "S001", ref: "Amina" },
      { name: "S002", ref: "John" },
    ]);
  });
});
