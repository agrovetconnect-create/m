import { test, expect } from "bun:test";
import { deriveSheets } from "../lib/sheets";
import type { Entry } from "../lib/store";

const e = (over: Partial<Entry>): Entry => ({
  id: "x",
  studentName: "A B",
  classId: "9B",
  assessment: "Quiz 1",
  mark: 5,
  maxMark: 10,
  confidence: 99,
  source: "manual",
  status: "confirmed",
  createdAt: "2026-01-01T00:00:00Z",
  deviceId: "d",
  signature: "s",
  synced: true,
  versions: [],
  ...over,
});

const roster = (classId: string): { id: string }[] =>
  classId === "9B" ? [{ id: "1" }, { id: "2" }, { id: "3" }] : [];

test("groups entries per class + assessment", () => {
  const rows = deriveSheets(
    [e({}), e({ studentName: "B C" }), e({ status: "pending", createdAt: "2026-01-02T00:00:00Z" })],
    roster,
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].entered).toBe(3);
  expect(rows[0].confirmed).toBe(2);
  expect(rows[0].total).toBe(3);
  expect(rows[0].updatedAt).toBe("2026-01-02T00:00:00Z");
});

test("status walks inProgress → needsReview → submitted", () => {
  expect(deriveSheets([e({})], roster)[0].status).toBe("inProgress");
  expect(deriveSheets([e({}), e({}), e({ status: "pending" })], roster)[0].status).toBe("needsReview");
  expect(deriveSheets([e({}), e({}), e({})], roster)[0].status).toBe("submitted");
});

test("falls back to entered count when the roster is empty", () => {
  const rows = deriveSheets([e({ classId: "10A" })], roster);
  expect(rows[0].total).toBe(1);
});

test("sorts newest first", () => {
  const rows = deriveSheets(
    [e({ assessment: "Quiz 1" }), e({ assessment: "Quiz 2", createdAt: "2026-02-01T00:00:00Z" })],
    roster,
  );
  expect(rows[0].assessment).toBe("Quiz 2");
});
