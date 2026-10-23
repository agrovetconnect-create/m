"""Unit tests for the live paper-detection proof of concept (headless)."""

import pytest

from detector import DetectorConfig, PaperTracker, ScanState, detect_paper
from synth import scenario_frame

PAGE = (280, 160, 400, 540)  # a portrait page centered-ish on the desk
DESK = (960, 720)


def sample(page=None, *, tracker=None, **kw):
    """One tracker observation on one synthetic frame."""
    frame = scenario_frame(page, **kw)
    tracker = tracker or PaperTracker()
    return tracker, tracker.observe(detect_paper(frame))


def test_empty_desk_reports_waiting():
    tracker, _ = sample(None)
    assert tracker.state is ScanState.WAITING


def test_single_page_is_detected():
    frame = scenario_frame(PAGE)
    regions = detect_paper(frame)
    assert len(regions) == 1
    x, y, w, h = PAGE
    assert abs(regions[0].x - x) < 12 and abs(regions[0].y - y) < 12
    assert abs(regions[0].w - w) < 16 and abs(regions[0].h - h) < 16


def test_stable_page_reaches_ready_after_stability_frames():
    tracker = PaperTracker()
    states = [sample(PAGE, tracker=tracker)[1] for _ in range(5)]
    assert ScanState.READY in states
    assert states.index(ScanState.READY) >= tracker.cfg.stability_frames - 1


def test_duplicate_page_is_suppressed():
    tracker = PaperTracker()
    assert ScanState.READY in run_frames(tracker, PAGE, 4)
    ready_events = tracker.diagnostics.ready_events
    for _ in range(4):
        tracker.observe(detect_paper(scenario_frame(PAGE)))
    assert tracker.state is ScanState.PROCESSED
    assert tracker.diagnostics.ready_events == ready_events


def run_frames(tracker, page, n, **kw):
    states = [tracker.observe(detect_paper(scenario_frame(page, **kw))) for _ in range(n)]
    return states


def test_paper_leaving_clears_processed_memory():
    tracker = PaperTracker()
    assert ScanState.READY in run_frames(tracker, PAGE, 4)
    for _ in range(tracker.cfg.leave_frames + 1):
        tracker.observe(detect_paper(scenario_frame(None)))
    assert tracker.state is ScanState.WAITING
    assert ScanState.READY in run_frames(tracker, PAGE, 4)  # re-entry triggers again


def test_blurry_page_never_reaches_ready():
    tracker = PaperTracker()
    for _ in range(6):
        sample(PAGE, sigma=4.0, tracker=tracker)
    assert tracker.state is ScanState.QUALITY_INSUFFICIENT


def test_underexposed_page_never_reaches_ready():
    tracker = PaperTracker()
    for _ in range(6):
        sample(PAGE, brightness=0.18, tracker=tracker)
    assert tracker.state is ScanState.QUALITY_INSUFFICIENT


def test_two_papers_report_multiple():
    frame = scenario_frame((120, 120, 340, 460))
    frame = __import__("synth").draw_page(frame, (560, 180, 320, 470))
    regions = detect_paper(frame)
    assert len(regions) >= 2
    tracker = PaperTracker()
    for _ in range(4):
        tracker.observe(regions)
    assert tracker.state is ScanState.MULTIPLE_PAPERS


def test_partial_page_touching_frame_edge_is_not_ready():
    # Page clipped by the frame edge → teacher must adjust before processing.
    frame = scenario_frame((900, 100, 300, 500))
    tracker = PaperTracker()
    for _ in range(5):
        tracker.observe(detect_paper(frame))
    assert tracker.state in {ScanState.QUALITY_INSUFFICIENT, ScanState.WAITING, ScanState.DETECTED}
    assert tracker.state is not ScanState.READY


def test_camera_disconnect_is_reported():
    tracker = PaperTracker()
    tracker.observe(None)
    assert tracker.state is ScanState.CAMERA_UNAVAILABLE


def test_small_shift_of_processed_page_stays_suppressed():
    """A page that twitches slightly after processing is the SAME placement."""
    tracker = PaperTracker()
    assert ScanState.READY in run_frames(tracker, PAGE, 4)
    shifted = (PAGE[0] + 8, PAGE[1] + 6, PAGE[2], PAGE[3])
    for _ in range(6):
        tracker.observe(detect_paper(scenario_frame(shifted)))
    assert tracker.state is ScanState.PROCESSED
    assert tracker.diagnostics.ready_events == 1  # no second trigger


def test_reset_processed_allows_retrigger():
    tracker = PaperTracker()
    assert ScanState.READY in run_frames(tracker, PAGE, 4)
    first = tracker.diagnostics.ready_events
    tracker.reset_processed()
    # Without the reset the same placement would sit in PROCESSED.
    run_frames(tracker, PAGE, 5)
    assert tracker.diagnostics.ready_events == first + 1  # triggered again


def test_detect_paper_rejects_sliver_shapes():
    frame = scenario_frame(None)
    # A long thin bright strip (ruler edge) must not count as a page.
    frame = __import__("synth").draw_page(frame, (100, 340, 700, 40))
    assert detect_paper(frame) == []


@pytest.mark.parametrize("w,h", [(400, 540), (540, 400), (300, 420)])
def test_portrait_and_landscape_pages_are_found(w, h):
    frame = scenario_frame((300, 160, w, h))
    regions = detect_paper(frame)
    assert len(regions) == 1
