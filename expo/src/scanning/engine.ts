/**
 * Stage 3 scanning integration boundary — the typed contract between the
 * scanning UI and any detection/recognition implementation.
 *
 * State semantics mirror the Stage 1 PoC's proven state machine
 * (proof-of-concept/live-paper-detection/detector.py): a READY trigger fires
 * once per placement and settles into processing; duplicates and quality
 * failures are explicit events, never silent.
 *
 * `scanStateMachine` is a pure reducer: platform adapters (web getUserMedia,
 * native system camera, future desktop) translate their hardware events into
 * `ScanningEvent`s; the UI renders `ScanUiState`. Tests drive the same
 * reducer with mocked events — no hardware required.
 */

export type CameraPhase =
  | "idle" // not started — camera never auto-starts without user action
  | "initializing"
  | "ready"
  | "unavailable" // no device present
  | "permissionDenied"
  | "disconnected";

export type ScanActivity =
  | "inactive"
  | "active"
  | "paperDetected"
  | "stabilizing"
  | "paperReady" // one-shot trigger pulse; UI should capture now
  | "processing"
  | "paused";

export type ScanAlertKind =
  | "duplicateSuppressed"
  | "qualityInsufficient"
  | "multiplePapers"
  | "processingFailed";

export type ScanningEvent =
  | { type: "camera"; phase: CameraPhase }
  | { type: "activity"; activity: ScanActivity }
  | { type: "alert"; kind: ScanAlertKind; detail?: string }
  | { type: "stop" };

export type ScanUiState = {
  camera: CameraPhase;
  activity: ScanActivity;
  /** Latest transient alert; cleared by the UI when acknowledged. */
  alert: { kind: ScanAlertKind; detail?: string } | null;
  /** Monotonic count of papers actually processed this session. */
  processedCount: number;
};

export const initialScanState: ScanUiState = {
  camera: "idle",
  activity: "inactive",
  alert: null,
  processedCount: 0,
};

/** Does this state allow a capture to be requested right now? */
export function canCapture(state: ScanUiState): boolean {
  return state.camera === "ready" && state.activity === "paperReady";
}

/** Is the camera resource in use (needs release on stop/unmount)? */
export function cameraInUse(state: ScanUiState): boolean {
  return state.camera === "initializing" || state.camera === "ready";
}

export function scanStateMachine(state: ScanUiState, event: ScanningEvent): ScanUiState {
  switch (event.type) {
    case "camera":
      // A disconnect mid-session pauses the activity but preserves counts.
      if (event.phase === "disconnected") {
        return { ...state, camera: event.phase, activity: state.activity === "inactive" ? "inactive" : "paused" };
      }
      return { ...state, camera: event.phase };
    case "activity": {
      // READY is a one-shot trigger pulse: the next explicit activity event
      // (e.g. processing) supersedes it; UI reads canCapture() in between.
      return { ...state, activity: event.activity };
    }
    case "alert":
      return { ...state, alert: { kind: event.kind, detail: event.detail } };
    case "stop":
      return initialScanState;
  }
}
