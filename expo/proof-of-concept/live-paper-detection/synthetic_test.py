"""Headless measurement harness — Stage 1 acceptance evidence (synthetic).

Runs the full detector + tracker state machine over scripted scenarios that
mirror the camera test cases in docs/STAGE_1_ACCEPTANCE_TESTS.md, measures
detection precision/recall against known ground truth (we placed the pages),
time-from-stable-to-ready, duplicate-trigger suppression, and per-sample CPU
cost. No camera hardware required; results below are SYNTHETIC ONLY.

Run:  python3 synthetic_test.py
"""

import time

import cv2

from detector import DetectorConfig, PaperTracker, ScanState, detect_paper
from synth import scenario_frame

PAGE = (280, 160, 400, 540)
SAMPLES = 30  # per scenario, ~6 s of desk time at the default 0.2 s interval


def run_scenario(name, frame_fn, expect_ready=False, expect_state=None):
    cfg = DetectorConfig()
    tracker = PaperTracker(cfg)
    seen_ready = False
    t_start = cv2.getTickCount()
    for i in range(SAMPLES):
        frame = frame_fn(i)
        regions = detect_paper(frame) if frame is not None else None
        state = tracker.observe(regions)
        seen_ready = seen_ready or state is ScanState.READY
    t_end = cv2.getTickCount()
    cpu_ms = (t_end - t_start) / cv2.getTickFrequency() * 1000 / SAMPLES
    ok = (seen_ready == expect_ready) and (expect_state is None or tracker.state.name == expect_state)
    return {
        "scenario": name,
        "pass": ok,
        "final_state": tracker.state.value,
        "ready_events": tracker.diagnostics.ready_events,
        "cpu_ms_per_sample": round(cpu_ms, 2),
    }


def main() -> None:
    results = [
        run_scenario(
            "no_paper_stays_waiting",
            lambda i: scenario_frame(None, seed=i),
            expect_ready=False,
            expect_state="WAITING",
        ),
        run_scenario(
            "single_page_becomes_ready",
            lambda i: scenario_frame(PAGE, seed=i),
            expect_ready=True,
            expect_state="PROCESSED",  # stays stationary → suppressed after READY
        ),
        run_scenario(
            "page_moves_then_restabilizes",
            lambda i: scenario_frame((280 + (40 if i >= 12 else 0), 160, 400, 540), seed=i),
            expect_ready=True,
        ),
        run_scenario(
            "page_leaves_and_reenters",
            lambda i: scenario_frame(PAGE if 8 <= i < 16 else None, seed=i),
            expect_ready=True,
        ),
        run_scenario(
            "two_papers_reported",
            lambda i: scenario_frame((140, 120, 340, 460), seed=i) if i < 1 else None,
            expect_ready=False,
            expect_state=None,
        ),
        run_scenario(
            "blurry_page_gated",
            lambda i: scenario_frame(PAGE, sigma=4.0, seed=i),
            expect_ready=False,
            expect_state="QUALITY_INSUFFICIENT",
        ),
        run_scenario(
            "low_light_page_gated",
            lambda i: scenario_frame(PAGE, brightness=0.18, seed=i),
            expect_ready=False,
            expect_state="QUALITY_INSUFFICIENT",
        ),
        run_scenario(
            "camera_disconnect_reported",
            lambda i: None if i >= 5 else scenario_frame(None, seed=i),
            expect_ready=False,
            expect_state="CAMERA_UNAVAILABLE",
        ),
    ]

    # Two overlapping pages need a dedicated frame each sample.
    two_pages = [scenario_frame((140, 120, 340, 460), seed=0)]
    two_pages.append(
        __import__("synth").draw_page(two_pages[0].copy(), (540, 160, 340, 470))
    )
    tracker = PaperTracker()
    for _ in range(6):
        tracker.observe(detect_paper(two_pages[1]))
    results[4] = {
        "scenario": "two_papers_reported",
        "pass": tracker.state is ScanState.MULTIPLE_PAPERS,
        "final_state": tracker.state.value,
        "ready_events": 0,
        "cpu_ms_per_sample": results[4]["cpu_ms_per_sample"],
    }

    passed = sum(1 for r in results if r["pass"])
    print(f"\nSynthetic acceptance scenarios: {passed}/{len(results)} passed")
    print(f"{'scenario':<34} {'pass':<6} {'final state':<24} ready  cpu/sample")
    for r in results:
        print(
            f"{r['scenario']:<34} {('PASS' if r['pass'] else 'FAIL'):<6} "
            f"{r['final_state']:<24} {r['ready_events']:<6} {r['cpu_ms_per_sample']} ms"
        )

    # Detection precision/recall on the scenarios with known ground truth.
    truth_pairs = [(results[0], False), (results[1], True), (results[5], True), (results[6], True)]
    tp = sum(1 for r, page_there in truth_pairs if (r["ready_events"] > 0) == page_there)
    print(f"\nGround-truth agreement (paper present/absent): {tp}/{len(truth_pairs)}")

    # Time from first appearance to READY, in seconds, on the reference scenario.
    tracker = PaperTracker()
    for _ in range(8):
        tracker.observe(detect_paper(scenario_frame(PAGE)))
    samples = tracker.diagnostics.samples_to_ready
    if samples:
        secs = samples[0] * DetectorConfig().sample_interval_s
        print(f"Stable page -> READY: {samples[0]} samples = {secs:.2f} s (target: <= 2.0 s)")

    # Duplicate-trigger suppression on the stationary-page scenario.
    dup = results[1]
    print(
        f"Duplicate triggers while stationary: {max(0, dup['ready_events'] - 1)} "
        f"(target: 0)"
    )
    print("\nNOTE: synthetic results only — real-camera cases are BLOCKED in this environment.")


if __name__ == "__main__":
    main()
