import type { EntryVersion } from "@/lib/store";

/**
 * Stage 3 domain models — the typed form of the Stage 1 data-model entities the
 * application foundation needs. These are framework-free (no react-native
 * imports) so recognition engines, storage adapters, and tests can share them.
 *
 * Relationship to the live store: `Entry`/`ClassRecord`/`StudentRecord` in
 * `lib/store.tsx` are the persisted shapes this app ships today; the types here
 * name the same concepts explicitly (and extend them for scanning/export) so
 * later stages can migrate storage without changing meaning.
 */

export type MarkSource = "ai" | "cv" | "manual";
export type MarkStatus = "extracted" | "needsReview" | "corrected" | "approved" | "rejected" | "exported";

/** Explicit recognition/verification states — no arbitrary strings. */
export type VerificationDecision = {
  at: string; // ISO timestamp
  by: string;
  action: "approved" | "rejected" | "corrected";
  note?: string;
};

export type ExtractedMark = {
  studentId: string;
  studentName: string;
  assessmentId: string;
  /** Raw recognition output before validation — kept separate from the validated value. */
  rawValue: string;
  /** Engine confidence 0–1; values below the floor (0.75) route to review. */
  confidence: number;
  source: MarkSource;
};

export type ScannedPage = {
  id: string;
  sessionId: string;
  /** Sequence in the session; duplicates are flagged, not silently accepted. */
  seq: number;
  /** Local-only reference to the captured image (never synced by default). */
  imageRef?: string;
  capturedAt: string;
};

export type OMRResponse = {
  pageId: string;
  question: number;
  /** Selected option(s); `multiple`/`ambiguous` states are flagged for the teacher. */
  selected: number[];
  state: "filled" | "blank" | "multiple" | "ambiguous";
};

export type ScanningSession = {
  id: string;
  classId: string;
  assessmentId: string;
  paperType: "ordinary" | "omr";
  startedAt: string;
  endedAt?: string;
  status: "active" | "paused" | "completed" | "interrupted";
};

export type ExportJob = {
  id: string;
  /** Path/key of the register this export reads from — exports never write here. */
  sourceRef: string;
  /** Destination of the produced copy (a new file, never the source). */
  outputRef: string;
  format: "xlsx" | "csv";
  createdAt: string;
  status: "pending" | "completed" | "failed" | "cancelled";
};

export type LicenseStatus =
  | { state: "unlicensed"; graceUntil: null }
  | { state: "active"; expiresAt: string }
  | { state: "grace"; graceUntil: string }
  | { state: "expired" };

export type SyncStatus = "pending" | "synced" | "conflict" | "error";

/** A student in the Stage 1 data model (mirrors the live `StudentRecord`). */
export type Student = {
  id: string;
  classId: string;
  name: string;
  /** Official register number, when the roster provides one. */
  ref?: string;
};

export type Class = {
  id: string;
  name: string;
  subject: string;
  grade: string;
};

export type Assessment = {
  id: string;
  classId: string;
  name: string;
  maxMark: number;
  paperType: "ordinary" | "omr";
  /** OMR only: the configured answer key, keyed by question number. */
  answerKey?: Record<number, number[]>;
};

export type PaperTemplate = {
  id: string;
  name: string;
  paperType: "ordinary" | "omr";
  /** Normalized zone map for recognition (ID, name, marks, bubbles). */
  zones: Record<string, { x: number; y: number; w: number; h: number }>;
};

/** A recognition result as the review UI consumes it. */
export type RecognitionResult = {
  pageId: string;
  mark: ExtractedMark;
  omr?: OMRResponse[];
  status: MarkStatus;
  /** Why the result is gated (unreadable, low confidence, duplicate, …). */
  gateReason?: string;
  versions: EntryVersion[];
  decisions: VerificationDecision[];
};
