/**
 * Cloud AI frame reader through the Rork Toolkit proxy (Vercel AI Gateway
 * vision). Both detection engines — this one and the self-hosted CV OCR
 * service — speak the same strict frame contract (see lib/vision-schema):
 * paper detection, read quality, student identifiers and a raw mark count.
 * The reader never grades and never returns a savable low-confidence guess:
 * anything gated (blurry, underexposed, no paper, no ID, no marks, confidence
 * below the floor) maps to null so callers route to manual entry.
 *
 * Note: detection runs server-side (the spec's optional higher-accuracy
 * re-check). A bundled on-device model requires a dev build and is the
 * documented offline roadmap; offline capture always routes to manual entry.
 */

import {
  mapVisionFrame,
  frameHudOf,
  type VisionFrame,
  type FrameHud,
  type PaperBounds,
} from "./vision-schema";

export type DetectedQuestion = { q: number; mark: number; confidence: number };

export type DetectionResult = {
  studentName?: string;
  /** ID / registration / admission number written on the paper, if any. */
  studentId?: string;
  className?: string;
  total?: number;
  max?: number;
  questions: DetectedQuestion[];
  /** Which engine produced this read: the cloud AI reader or the CV (OCR) service. */
  engine?: "ai" | "cv";
  /** Page-level read confidence 0..1 — the CV engine reports one value for the whole sheet. */
  confidence?: number;
  /** Normalized paper bounding box reported by the engine, for the live overlay. */
  paperBounds?: PaperBounds;
};

/**
 * Shared holder so the review screens can auto-fill from the last scan.
 * `context` carries the sheet setup chosen on the new-marksheet form
 * (assessment name, class id, total) so every downstream screen uses the
 * teacher's real selections instead of any hardcoded defaults.
 */
export const lastDetection: {
  current: DetectionResult | null;
  image: string | null;
  context: { assessment: string; classId: string; maxMark: number } | null;
} = {
  current: null,
  image: null,
  context: null,
};

/**
 * HUD feed: the last frame's real engine response — read quality, confidence,
 * latency and the detected paper bounds — updated on EVERY parsed frame, even
 * gated ones, so the scan screen's overlay always shows what the engine saw.
 */
export const lastFrame: { current: FrameHud | null } = { current: null };

const URL = process.env.EXPO_PUBLIC_TOOLKIT_URL ?? "";
const KEY = process.env.EXPO_PUBLIC_RORK_TOOLKIT_SECRET_KEY ?? "";

/**
 * The frame-analysis system contract: segment + quality-check the paper,
 * extract structural identifiers, count physical marks (raw counts only —
 * no grading), and answer with a single minified JSON line. Any quality
 * failure (motion blur, occlusion, underexposure, no paper) must be flagged
 * in read_quality instead of being guessed around.
 */
const FRAME_PROMPT = `You are an edge-optimized computer vision engine operating as a high-throughput backend service for a React Native continuous frame scanning application (1 FPS). Your objective is real-time OCR and object detection on student test papers passing rapidly in front of a mobile device camera. Mitigate dynamic shadows from the device, lens distortion, perspective skewing, hand-shake motion blur, and background edge clutter.
1. Image segmentation & quality check: isolate the boundaries of the paper document. Evaluate text sharpness. If severe motion blur or occlusion prevents character recognition, flag the quality immediately.
2. OCR extraction: extract the primary structural identifiers (student ID / registration number, full name). Normalize strings (strip accidental leading/trailing spaces).
3. Object detection: scan the entire document matrix to count physical marks (checkmarks, "X" marks, score circles). Do not grade or evaluate the student; perform raw mathematical counts only.
Respond strictly with a valid, single line, minified JSON object. Do NOT wrap the JSON inside markdown text block wrappers. Do not return any preamble, conversational explanations, or postscript text. If you fail to parse, emit the valid JSON payload with null properties. Schema: {"paper_detected":boolean,"metadata":{"read_quality":"clear"|"blurry"|"underexposed","inference_latency_ms_estimate":integer,"paper_bounds":{"x":float,"y":float,"w":float,"h":float}|null},"student_identifiers":{"extracted_id":string|null,"extracted_name":string|null},"grading_metrics":{"detected_marks_count":integer,"confidence_score":float}}. confidence_score is 0.0-1.0. paper_bounds is the paper's bounding box in normalized 0..1 coordinates (top-left origin, w/h as fractions of the frame); null when no paper is detected. The student's name may be written in ANY language or script (Latin, Arabic, Swahili, French, Portuguese, etc.) — transcribe it exactly as written. Never invent identifiers or marks you cannot see.`;

/** Extract the strict JSON object from a model response, fences tolerated defensively. */
function parseFrame(raw: string): VisionFrame | null {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  const body = fenced ? fenced[1] : trimmed;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1)) as VisionFrame;
  } catch {
    return null;
  }
}

export async function detectMarks(imageBase64: string): Promise<DetectionResult | null> {
  lastFrame.current = null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 45_000);
  try {
    const res = await fetch(`${URL}/v2/vercel/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: FRAME_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: "Analyze this captured frame of a student paper." },
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
            ],
          },
        ],
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const frame = parseFrame(json.choices?.[0]?.message?.content ?? "");
    if (!frame) return null;
    // Defensive normalization: a model may report confidence on a 0-100 scale.
    const score = frame.grading_metrics?.confidence_score;
    if (frame.grading_metrics && typeof score === "number" && score > 1) {
      frame.grading_metrics.confidence_score = score / 100;
    }
    // Feed the HUD from the real response before any gating happens.
    lastFrame.current = frameHudOf(frame);
    const { result } = mapVisionFrame(frame, "ai");
    if (!result) return null;
    lastDetection.current = result;
    lastDetection.image = imageBase64;
    return lastDetection.current;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
