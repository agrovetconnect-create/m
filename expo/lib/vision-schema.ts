/**
 * Shared frame-analysis contract (strict JSON) spoken by both detection
 * engines: the self-hosted CV service (`/vision/analyze`) and the cloud AI
 * reader. Both return exactly this schema:
 *
 *   { paper_detected, metadata: { read_quality, inference_latency_ms_estimate,
 *     paper_bounds }, student_identifiers: { extracted_id, extracted_name },
 *     grading_metrics: { detected_marks_count, confidence_score } }
 *
 * A frame read may only flow into the batch when the paper is detected, sharp
 * and well exposed, an ID is legible, at least one mark is counted and the
 * confidence clears the floor — everything else is gated to manual entry.
 * Nothing is ever guessed, and the engine only ever counts marks (raw
 * mathematical counts) — it never grades or evaluates the student.
 */
import type { DetectionResult } from "./ai";

export type ReadQuality = "clear" | "blurry" | "underexposed";

/** Normalized (0..1, top-left origin) bounds of the paper region in the frame. */
export type PaperBounds = { x: number; y: number; w: number; h: number };

export type VisionFrame = {
  paper_detected: boolean;
  metadata: {
    read_quality: ReadQuality;
    inference_latency_ms_estimate: number;
    paper_bounds?: PaperBounds | null;
  };
  student_identifiers: { extracted_id: string | null; extracted_name: string | null };
  grading_metrics: { detected_marks_count: number; confidence_score: number };
};

/** Live HUD values shown on the scan screen straight from the engine response. */
export type FrameHud = {
  readQuality: ReadQuality;
  /** 0..1 confidence score as returned by the engine. */
  confidence: number;
  latencyMs: number;
  paperBounds: PaperBounds | null;
};

/** Extract the HUD overlay values from any frame response (gated or passing). */
export function frameHudOf(frame: VisionFrame): FrameHud {
  return {
    readQuality: frame?.metadata?.read_quality ?? "blurry",
    confidence: frame?.grading_metrics?.confidence_score ?? 0,
    latencyMs: frame?.metadata?.inference_latency_ms_estimate ?? 0,
    paperBounds: frame?.metadata?.paper_bounds ?? null,
  };
}

/** Mirrors the server's CONFIDENCE_FLOOR — a low-confidence read never saves. */
export const CLIENT_CONFIDENCE_FLOOR = 0.75;

/** Why a frame read was gated (null = it passed and produced a result). */
export type FrameGateReason =
  | "no_paper"
  | "quality"
  | "no_identity"
  | "no_marks"
  | "low_confidence"
  | null;

/**
 * Gate and map a frame read to the app's DetectionResult.
 * `engine` tags which reader produced the frame (cloud AI or CV OCR).
 */
export function mapVisionFrame(
  frame: VisionFrame,
  engine: "ai" | "cv",
): { result: DetectionResult | null; reason: FrameGateReason } {
  if (!frame || typeof frame !== "object") return { result: null, reason: "no_paper" };
  if (frame.paper_detected !== true) return { result: null, reason: "no_paper" };
  // Blurry / underexposed / occluded frames are flagged immediately — retake.
  if (frame.metadata?.read_quality !== "clear") return { result: null, reason: "quality" };
  const id = frame.student_identifiers?.extracted_id?.trim();
  if (!id) return { result: null, reason: "no_identity" };
  const count = frame.grading_metrics?.detected_marks_count ?? 0;
  if (!Number.isFinite(count) || count <= 0) return { result: null, reason: "no_marks" };
  const confidence = frame.grading_metrics?.confidence_score ?? 0;
  if (!Number.isFinite(confidence) || confidence < CLIENT_CONFIDENCE_FLOOR) {
    return { result: null, reason: "low_confidence" };
  }
  const name = frame.student_identifiers?.extracted_name?.trim() || undefined;
  return {
    result: {
      studentName: name,
      studentId: id,
      // Raw mark count from the paper; the max comes from the teacher's own
      // sheet setup (the engine never grades, so it never supplies a max).
      total: Math.round(count),
      questions: [],
      engine,
      confidence,
      paperBounds: frame.metadata?.paper_bounds ?? undefined,
    },
    reason: null,
  };
}
