"""Live paper detection — real-camera runner (webcam).

Opens /dev/video* (or the OS default camera), samples frames at the configured
interval, draws the current state and page bounds over the preview, and records
diagnostics to stdout. Keyboard: R = process the page again, Q = quit.

Requires a real camera (OpenCV VideoCapture). In the development sandbox there
is no camera hardware — use synthetic_test.py there, and run this on a laptop
or device with a webcam.

Run:  python3 main.py [--camera 0] [--interval 0.2]
"""

import argparse
import time

import cv2

from detector import DetectorConfig, PaperTracker, ScanState, detect_paper

OVERLAY_COLORS = {
    ScanState.WAITING: (160, 160, 160),
    ScanState.DETECTED: (255, 200, 0),
    ScanState.STABILIZING: (255, 160, 0),
    ScanState.READY: (0, 220, 0),
    ScanState.PROCESSED: (0, 160, 255),
    ScanState.QUALITY_INSUFFICIENT: (0, 0, 255),
    ScanState.MULTIPLE_PAPERS: (0, 80, 255),
    ScanState.CAMERA_UNAVAILABLE: (0, 0, 255),
}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--camera", type=int, default=0)
    parser.add_argument("--interval", type=float, default=DetectorConfig().sample_interval_s)
    args = parser.parse_args()

    cfg = DetectorConfig(sample_interval_s=args.interval)
    cap = cv2.VideoCapture(args.camera)
    tracker = PaperTracker(cfg)
    last_sample = 0.0
    print("Live paper-detection PoC — Q quit, R re-process page")

    try:
        while True:
            if not cap.isOpened():
                tracker.observe(None)
                time.sleep(2.0)
                cap = cv2.VideoCapture(args.camera)  # reconnect attempt
                continue

            ok, frame = cap.read()
            if not ok:
                tracker.observe(None)
                print("Camera disconnected; retrying every 2 s")
                cap.release()
                time.sleep(2.0)
                cap = cv2.VideoCapture(args.camera)
                continue

            now = time.monotonic()
            if now - last_sample >= cfg.sample_interval_s:
                last_sample = now
                regions = detect_paper(frame, cfg)
                tracker.observe(regions)

            if tracker._prev_bounds:  # draw the tracked page bounds
                x, y, w, h = tracker._prev_bounds
                color = OVERLAY_COLORS[tracker.state]
                cv2.rectangle(frame, (x, y), (x + w, y + h), color, 2)
            cv2.putText(
                frame, f"STATE: {tracker.state.value}", (16, 36),
                cv2.FONT_HERSHEY_SIMPLEX, 1.0, OVERLAY_COLORS[tracker.state], 2,
            )
            cv2.imshow("live-paper-detection", frame)
            key = cv2.waitKey(30) & 0xFF
            if key in (ord("q"), ord("Q")):
                break
            if key in (ord("r"), ord("R")):
                tracker.reset_processed()
    finally:
        cap.release()
        cv2.destroyAllWindows()
        print("Diagnostics:", tracker.diagnostics.as_dict())


if __name__ == "__main__":
    main()
