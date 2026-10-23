/**
 * Register-management domain rules — students, classes, assessments. Pure
 * functions over plain record shapes so the store, the import wizard, and the
 * tests share one implementation.
 *
 * Identity policy (Stage 4 spec): a student's `ref` (registration/candidate
 * number) is the stable identifier when present on BOTH records. A name match
 * alone is never an automatic merge — it surfaces as a possible duplicate with
 * the reason stated, for explicit teacher resolution.
 */

export type StudentLike = { id: string; classId: string; name: string; ref?: string };

/** Whitespace/case/accents-insensitive key for names and refs. */
export function identityKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff\u4e00-\u9fff]+/g, " ")
    .trim();
}

// --- Students ---------------------------------------------------------------

export type StudentValidation =
  | { ok: true }
  | { ok: false; field: "name" | "ref"; reason: "required" | "too_long" | "duplicate_ref" };

const MAX_NAME = 80;
const MAX_REF = 40;

/** Validate one student record against a class roster (context for ref dupes). */
export function validateStudent(
  student: { name: string; ref?: string },
  existing: StudentLike[],
): StudentValidation {
  const name = student.name.trim();
  if (!name) return { ok: false, field: "name", reason: "required" };
  if (name.length > MAX_NAME) return { ok: false, field: "name", reason: "too_long" };
  const ref = student.ref?.trim();
  if (ref && ref.length > MAX_REF) return { ok: false, field: "ref", reason: "too_long" };
  if (ref && existing.some((s) => s.ref?.trim() && identityKey(s.ref!) === identityKey(ref))) {
    return { ok: false, field: "ref", reason: "duplicate_ref" };
  }
  return { ok: true };
}

export type DuplicateMatch = {
  existingId: string;
  existingName: string;
  existingRef?: string;
  /** Why the records may be the same student — shown to the teacher. */
  reason: "same_ref" | "same_name";
};

/**
 * Find existing students the incoming record may match. `same_ref` is a strong
 * match (stable identifier on both sides); `same_name` is a warning only —
 * never auto-merged, never silently skipped.
 */
export function findDuplicateMatches(
  incoming: { name: string; ref?: string },
  existing: StudentLike[],
): DuplicateMatch[] {
  const inRef = incoming.ref?.trim();
  const inName = identityKey(incoming.name);
  const matches: DuplicateMatch[] = [];
  for (const s of existing) {
    const ref = s.ref?.trim();
    if (inRef && ref && identityKey(ref) === identityKey(inRef)) {
      matches.push({ existingId: s.id, existingName: s.name, existingRef: s.ref, reason: "same_ref" });
      continue;
    }
    if (!inRef && !ref && inName !== "" && identityKey(s.name) === inName) {
      // Name-only matching applies only when NEITHER side carries a stable ref.
      matches.push({ existingId: s.id, existingName: s.name, existingRef: s.ref, reason: "same_name" });
    }
  }
  return matches;
}

export type StudentImportChoice = "skip" | "update" | "keep_both";

/**
 * Resolve a duplicate the way the teacher chose. Returns the updated existing
 * record (`update` — the ONLY path that ever overwrites, with exactly the
 * fields the teacher confirmed) or null (`skip` = keep existing, drop incoming)
 * or "keep_both" marker via the incoming record untouched.
 */
export function resolveDuplicate(
  existing: StudentLike,
  incoming: { name: string; ref?: string },
  choice: StudentImportChoice,
): StudentLike | "keep_both" | null {
  if (choice === "keep_both") return "keep_both";
  if (choice === "skip") return null;
  return { ...existing, name: incoming.name.trim(), ref: incoming.ref?.trim() ?? existing.ref };
}

// --- Classes ----------------------------------------------------------------

export type ClassLike = { id: string; name: string; subject: string; grade: string };

/** Two classes are the same when name AND grade match, ignoring case/accents. */
export function classIdentityKey(c: { name: string; grade: string }): string {
  return `${identityKey(c.name)}::${identityKey(c.grade)}`;
}

export function findDuplicateClass(
  candidate: { name: string; grade: string },
  existing: ClassLike[],
): ClassLike | null {
  const key = classIdentityKey(candidate);
  return existing.find((c) => classIdentityKey(c) === key) ?? null;
}

/** Case/accent-insensitive search over name, subject, and grade. */
export function filterClasses<T extends ClassLike>(classes: T[], query: string): T[] {
  const q = identityKey(query);
  if (!q) return classes;
  return classes.filter((c) =>
    [c.name, c.subject, c.grade].some((f) => identityKey(f).includes(q)),
  );
}

// --- Assessments ------------------------------------------------------------

export type AssessmentCandidate = { name: string; maxMark: number };

export type AssessmentValidation =
  | { ok: true }
  | { ok: false; field: "name" | "maxMark"; reason: "required" | "not_positive" | "duplicate" };

/**
 * Validate an assessment: a name is required and the maximum mark must be a
 * valid positive number. A duplicate (same class + normalized name) is an error
 * unless the teacher is editing that same assessment — compare callers pass the
 * entries they already recorded for the class.
 */
export function validateAssessment(
  candidate: AssessmentCandidate,
  existingNames: string[],
): AssessmentValidation {
  const name = candidate.name.trim();
  if (!name) return { ok: false, field: "name", reason: "required" };
  if (!(candidate.maxMark > 0) || !Number.isFinite(candidate.maxMark)) {
    return { ok: false, field: "maxMark", reason: "not_positive" };
  }
  const key = identityKey(name);
  if (existingNames.some((n) => identityKey(n) === key)) {
    return { ok: false, field: "name", reason: "duplicate" };
  }
  return { ok: true };
}
