/**
 * Mark validation — pure domain rules, deliberately separate from OCR and
 * recognition logic (Stage 1 recognition plan §1 step 7) so any engine, the
 * review UI, and the import mapper reuse the same gate. Malformed input is
 * never silently coerced into a mark: every failure carries an explicit reason.
 */

export type MarkValidationReason =
  | "empty"
  | "notNumeric"
  | "negative"
  | "aboveMax"
  | "tooManyDecimals"
  | "notFinite";

export type MarkValidation =
  | { ok: true; value: number }
  | { ok: false; reason: MarkValidationReason; message: string };

const MAX_DECIMALS = 2;

/**
 * Validate a mark against its maximum. Accepts numbers or the raw string a
 * recognition engine/import produced. Fractions like "34/50" are NOT accepted
 * here — that is annotation parsing (engine-side), not mark validation.
 */
export function validateMark(raw: number | string, maxMark: number): MarkValidation {
  if (maxMark <= 0 || !Number.isFinite(maxMark)) {
    // A non-positive max is a configuration error upstream; be loud, not silent.
    return { ok: false, reason: "notFinite", message: "Maximum mark must be a positive number" };
  }
  if (raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "")) {
    return { ok: false, reason: "empty", message: "Mark is missing" };
  }
  const value = typeof raw === "number" ? raw : Number(raw.trim().replace(",", "."));
  if (typeof raw === "string" && (raw.trim() === "" || Number.isNaN(value))) {
    return { ok: false, reason: "notNumeric", message: `"${raw}" is not a number` };
  }
  if (!Number.isFinite(value)) {
    return { ok: false, reason: "notFinite", message: "Mark must be a finite number" };
  }
  if (value < 0) {
    return { ok: false, reason: "negative", message: "Mark cannot be negative" };
  }
  if (value > maxMark) {
    return { ok: false, reason: "aboveMax", message: `Mark ${value} exceeds the maximum of ${maxMark}` };
  }
  const decimals = (String(value).split(".")[1] ?? "").length;
  if (decimals > MAX_DECIMALS) {
    return {
      ok: false,
      reason: "tooManyDecimals",
      message: `At most ${MAX_DECIMALS} decimal places are supported`,
    };
  }
  return { ok: true, value };
}

/**
 * Duplicate guard for (student, assessment) pairs — used by the review UI,
 * the import mapper, and scan chaining. Comparison is exact on the
 * canonical keys; name similarity is roster matching's job, not this rule's.
 */
export function duplicateKey(studentId: string, assessmentId: string): string {
  return `${studentId}::${assessmentId}`;
}

export function isDuplicate(studentId: string, assessmentId: string, seen: string[]): boolean {
  return seen.includes(duplicateKey(studentId, assessmentId));
}
