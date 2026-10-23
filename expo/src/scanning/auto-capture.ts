/**
 * Stage 5 automatic-capture engine — the capture-decision brain, kept fully
 * separate from UI rendering (master prompt §7).
 *
 * Pure and synchronous: the platform loop feeds one `observe()` call per
 * sampled frame; the tracker advances a documented state machine and emits a
 * `capture` request only when the policy is satisfied. No timers of its own —
 * elapsed time enters only through the frame timestamps (stability is counted
 * in consecutive geometrically-stable SAMPLES, never time alone).
 *
 * State machine (master §7, adapted to the Stage 1 PoC's proven vocabulary):
 *   searching → candidateDetected → waitingStability → captureReady
 *   → (beginCapture) capturing → (finishCapture) captured → cooldown → searching
 *   with failure, pause, quality, multiple-papers and camera-loss branches.
 */

import { type PaperRegion, iou, fingerprintDistance } from "./paper-detect";

export type CapturePhase =
  | "searching" // no paper in frame
  | "candidateDetected" // a plausible paper just appeared
  | "waitingStability" // paper present but still moving
  | "captureReady" // policy satisfied — UI should capture NOW
  | "capturing" // single-flight: a capture is in progress
  | "saving" // image bytes being persisted (capture op still in flight)
  | "captured" // saved; same sheet suppressed until removed/replaced
  | "cooldown" // brief re-arm guard after a capture
  | "qualityInsufficient" // blurry / too dark / partial page
  | "multiplePapers"
  | "paused"
  | "cameraLost"
  | "failed"; // capture/save failed — recovery path

export type CapturePolicy = {
  /** Consecutive geometrically-stable samples before capture-ready. */
  stabilityFrames: number;
  /** Bounds IoU between consecutive samples that counts as "still". */
  stabilityIou: number;
  /** IoU with the already-captured sheet that counts as "same sheet". */
  duplicateIou: number;
  /** Consecutive empty samples before the desk is considered clear (re-arm). */
  leaveFrames: number;
  /** ms after a capture during which nothing auto-fires. */
  cooldownMs: number;
  /** Rejected candidates linger in quality state for at least this long. */
  qualityHoldMs: number;
};

export const defaultCapturePolicy: CapturePolicy = {
  stabilityFrames: 3,
  stabilityIou: 0.88,
  duplicateIou: 0.9,
  leaveFrames: 2,
  cooldownMs: 1200,
  qualityHoldMs: 500,
};

/** Fingerprint similarity bands (mean absolute cell diff, 0–255 scale). */
export const FP_SAME = 8; // ≤ → same sheet
export const FP_DIFFERENT = 20; // ≥ → a genuinely different sheet; between → ambiguous

export type TrackerDecision = {
  phase: CapturePhase;
  /** True exactly once per armed placement — the UI must capture now. */
  capture: boolean;
  /** Set on a capture that passed geometry but looked possibly-same (ambiguous fingerprint). */
  possibleDuplicate?: boolean;
  reason?: string;
};

export type ObserveInput = {
  /** Detections for this sample; `null` = camera produced no frame (loss). */
  regions: PaperRegion[] | null;
  /** Monotonic ms timestamp of this sample. */
  tMs: number;
  /** Fingerprint provider for the primary region (optional content check). */
  fingerprintOf?: (r: PaperRegion) => Uint8Array | null;
};

/** Quality gate — separate from geometry so screens can guide the teacher. */
export type QualityIssue = "blurry" | "tooDark" | "partialPage" | null;

export function qualityIssueOf(
  r: PaperRegion,
  floors: { sharpnessFloor: number; luminanceFloor: number },
): QualityIssue {
  if (r.touchesEdge) return "partialPage";
  if (r.sharpness < floors.sharpnessFloor) return "blurry";
  if (r.luminance < floors.luminanceFloor) return "tooDark";
  return null;
}

export const defaultQualityFloors = { sharpnessFloor: 35, luminanceFloor: 60 };

/**
 * The tracker. Duplicates are prevented at THREE levels (master §8): geometry
 * (duplicateIoU with the captured sheet), re-arm discipline (sheet must leave
 * `leaveFrames` consecutive samples before re-arming) and content fingerprints
 * with an ambiguity band that flags rather than discards. Plus a cooldown.
 */
export class CaptureTracker {
  phase: CapturePhase = "searching";
  private policy: CapturePolicy;
  private prevBounds: { x: number; y: number; w: number; h: number } | null = null;
  private stableCount = 0;
  private emptyCount = 0;
  private capturedBounds: { x: number; y: number; w: number; h: number } | null = null;
  private capturedFingerprint: Uint8Array | null = null;
  private lastCaptureAt = -Infinity;
  private capturing = false;
  private paused = false;
  private armed = true;

  constructor(policy: CapturePolicy = defaultCapturePolicy) {
    this.policy = { ...policy };
  }

  pause(): void {
    this.paused = true;
    this.phase = "paused";
    this.stableCount = 0;
    this.prevBounds = null;
  }

  /** Resume re-arms from scratch: the scene may have changed while paused. */
  resume(): void {
    this.paused = false;
    this.phase = "searching";
    this.prevBounds = null;
    this.stableCount = 0;
  }

  /** Teacher-forced re-arm ("capture this sheet again"). */
  forceRearm(): void {
    this.capturedBounds = null;
    this.capturedFingerprint = null;
    this.armed = true;
  }

  isCapturing(): boolean {
    return this.capturing;
  }

  /** Single-flight guard: only one capture operation may run at a time. */
  beginCapture(): boolean {
    if (this.capturing || this.paused) return false;
    this.capturing = true;
    this.phase = "capturing";
    return true;
  }

  /** Capture operation finished (successfully or not). Starts the cooldown;
   * on success call `rememberCaptured` so the sheet stays suppressed. */
  finishCapture(tMs: number, ok: boolean): void {
    this.capturing = false;
    this.lastCaptureAt = tMs;
    if (ok) {
      this.phase = "captured";
      this.armed = false;
    } else {
      this.phase = "failed";
    }
  }

  observe(input: ObserveInput): TrackerDecision {
    const { regions, tMs } = input;
    if (this.paused) return { phase: this.phase, capture: false };
    if (this.capturing) return { phase: "capturing", capture: false };

    // Camera loss is not "no paper" — it pauses the machine.
    if (regions === null) {
      this.phase = "cameraLost";
      this.prevBounds = null;
      this.stableCount = 0;
      return { phase: this.phase, capture: false };
    }

    // Multiple distinct candidates: ask the teacher to isolate one sheet.
    if (regions.length > 1) {
      const primary = regions[0];
      const others = regions.slice(1).some((r) => iou(r, primary) < 0.5);
      this.resetStability();
      if (others) {
        this.phase = "multiplePapers";
        return { phase: this.phase, capture: false };
      }
    }

    const page = regions[0] ?? null;
    if (!page) {
      this.emptyCount++;
      this.prevBounds = null;
      this.stableCount = 0;
      if (this.emptyCount >= this.policy.leaveFrames) {
        // Desk clear: forget the captured sheet — the next placement arms fresh.
        this.capturedBounds = null;
        this.capturedFingerprint = null;
        this.armed = true;
        this.phase = "searching";
      } else if (this.phase !== "captured" && this.phase !== "cooldown") {
        this.phase = "searching";
      }
      return { phase: this.phase, capture: false };
    }
    this.emptyCount = 0;

    const bounds = { x: page.x, y: page.y, w: page.w, h: page.h };

    // Level 1+2 duplicate suppression: the SAME sheet, still in the SAME
    // place, that already triggered a capture is never re-triggered —
    // regardless of cooldown expiry.
    const samePlacement =
      this.capturedBounds !== null &&
      iou(bounds, this.capturedBounds) >= this.policy.duplicateIou &&
      this.prevBounds !== null &&
      iou(bounds, this.prevBounds) >= this.policy.stabilityIou;
    if (samePlacement && !this.armed) {
      this.phase = "captured";
      return { phase: this.phase, capture: false };
    }

    // Cooldown after a capture (also covers the failed-recovery path).
    if (tMs - this.lastCaptureAt < this.policy.cooldownMs) {
      this.phase = "cooldown";
      return { phase: this.phase, capture: false };
    }

    // Geometric quality gates — measurable issues only (master §11).
    const quality = qualityIssueOf(page, defaultQualityFloors);
    if (quality) {
      this.resetStability();
      this.phase = "qualityInsufficient";
      return { phase: this.phase, capture: false, reason: quality };
    }

    const still = this.prevBounds !== null && iou(bounds, this.prevBounds) >= this.policy.stabilityIou;
    this.stableCount = still ? this.stableCount + 1 : 1;
    this.prevBounds = bounds;

    if (this.stableCount < this.policy.stabilityFrames) {
      this.phase = this.stableCount > 1 ? "waitingStability" : "candidateDetected";
      return { phase: this.phase, capture: false };
    }

    // Stability satisfied — but is this the SAME sheet we already captured?
    // A removed-and-replaced sheet passes level 1+2 (capturedBounds cleared);
    // the fingerprint check is the last line of defense against an identical
    //-looking sheet in a marginally different position.
    if (this.capturedFingerprint && input.fingerprintOf) {
      const fp = input.fingerprintOf(page);
      if (fp) {
        const d = fingerprintDistance(fp, this.capturedFingerprint);
        if (d <= FP_SAME) {
          this.phase = "captured";
          return { phase: this.phase, capture: false };
        }
        if (d < FP_DIFFERENT) {
          // Ambiguous: prefer RETAINING the image and flagging for review
          // over silently discarding a possibly-different sheet (master §8).
          this.lastCaptureAt = tMs; // do not machine-gun captures while ambiguous
          return { phase: "captureReady", capture: true, possibleDuplicate: true };
        }
      }
    }

    this.phase = "captureReady";
    return { phase: this.phase, capture: true };
  }

  /** Record the captured sheet so it stays suppressed until removed/replaced. */
  rememberCaptured(bounds: { x: number; y: number; w: number; h: number }, fingerprint: Uint8Array | null): void {
    this.capturedBounds = { ...bounds };
    this.capturedFingerprint = fingerprint ? Uint8Array.from(fingerprint) : null;
    this.armed = false;
    this.resetStability();
  }

  private resetStability(): void {
    this.stableCount = 0;
    this.prevBounds = null;
  }
}
