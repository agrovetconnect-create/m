import { expect, test } from "bun:test";
import { detectMarksCV } from "../lib/cv";
import { CLIENT_CONFIDENCE_FLOOR, mapVisionFrame, frameHudOf, type VisionFrame } from "../lib/vision-schema";

/** Build a frame read that passes every gate, then override single fields. */
function frame(over: {
  paper_detected?: boolean;
  read_quality?: VisionFrame["metadata"]["read_quality"];
  id?: string | null;
  name?: string | null;
  count?: number;
  confidence?: number;
} = {}): VisionFrame {
  return {
    paper_detected: over.paper_detected ?? true,
    metadata: { read_quality: over.read_quality ?? "clear", inference_latency_ms_estimate: 120 },
    student_identifiers: {
      extracted_id: over.id === undefined ? "REG-2026-9843" : over.id,
      extracted_name: over.name === undefined ? "Dana Whitfield" : over.name,
    },
    grading_metrics: {
      detected_marks_count: over.count ?? 88,
      confidence_score: over.confidence ?? 0.91,
    },
  };
}

test("mapVisionFrame maps a clean read with engine metadata", () => {
  const { result, reason } = mapVisionFrame(frame(), "cv");
  expect(reason).toBe(null);
  expect(result).toEqual({
    studentName: "Dana Whitfield",
    studentId: "REG-2026-9843",
    total: 88,
    questions: [],
    engine: "cv",
    confidence: 0.91,
  });
  // Both engines speak the same contract — the cloud AI reader is tagged "ai".
  expect(mapVisionFrame(frame(), "ai").result?.engine).toBe("ai");
});

test("mapVisionFrame flags quality failures immediately — spec stage 1", () => {
  expect(mapVisionFrame(frame({ read_quality: "blurry" }), "cv")).toEqual({
    result: null,
    reason: "quality",
  });
  expect(mapVisionFrame(frame({ read_quality: "underexposed" }), "cv")).toEqual({
    result: null,
    reason: "quality",
  });
  expect(mapVisionFrame(frame({ paper_detected: false }), "cv")).toEqual({
    result: null,
    reason: "no_paper",
  });
});

test("mapVisionFrame gates reads without identity, marks or confidence — never a guess", () => {
  expect(mapVisionFrame(frame({ id: null }), "cv").reason).toBe("no_identity");
  expect(mapVisionFrame(frame({ id: "   " }), "cv").reason).toBe("no_identity");
  expect(mapVisionFrame(frame({ count: 0 }), "cv").reason).toBe("no_marks");
  expect(mapVisionFrame(frame({ confidence: 0.4 }), "cv").reason).toBe("low_confidence");
  // Exactly at the floor passes; anything below is gated to manual entry.
  expect(mapVisionFrame(frame({ confidence: CLIENT_CONFIDENCE_FLOOR }), "cv").reason).toBe(null);
});

test("mapVisionFrame normalizes identifier strings (spec: strip stray spaces)", () => {
  const { result } = mapVisionFrame(frame({ id: "  REG-2026-9843 ", name: "  Dana " }), "cv");
  expect(result?.studentId).toBe("REG-2026-9843");
  expect(result?.studentName).toBe("Dana");
});

test("detectMarksCV reports unreachable when the service is down", async () => {
  // Port 1 refuses connections immediately — no network needed for the test.
  const { result, error } = await detectMarksCV("aGVsbG8=", "http://127.0.0.1:1");
  expect(result).toBe(null);
  expect(error).toBe("unreachable");
});

test("frameHudOf + paper bounds feed the live HUD overlay", () => {
  const bounded = frame();
  bounded.metadata.paper_bounds = { x: 0.1, y: 0.2, w: 0.6, h: 0.7 };
  expect(frameHudOf(bounded)).toEqual({
    readQuality: "clear",
    confidence: 0.91,
    latencyMs: 120,
    paperBounds: { x: 0.1, y: 0.2, w: 0.6, h: 0.7 },
  });
  // A passing read carries the engine's bounds for the dynamic box overlay.
  const { result } = mapVisionFrame(bounded, "cv");
  expect(result?.paperBounds).toEqual({ x: 0.1, y: 0.2, w: 0.6, h: 0.7 });
  // A frame without measured bounds maps to a null box (static guide shown).
  expect(frameHudOf(frame()).paperBounds).toBe(null);
});
