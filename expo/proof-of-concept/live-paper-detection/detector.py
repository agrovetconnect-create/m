"""Live paper detection — Stage 1 proof of concept.

Approach: affordable classical OpenCV (grayscale → Otsu threshold on brightness
→ contour analysis with geometric checks), deliberately chosen over a heavier
ML model until measurements show it is inadequate. Quality assessment
(Laplacian-variance sharpness, mean luminance) matches the thresholds already
validated in vision-service so both components speak the same language.

The detector knows NOTHING about marks, handwriting, or OCR. Its only job is:
is there a page, is it stable, is it readable, has it already been processed.

Runs headless (synthetic frames) or with a real webcam (see main.py).
"""

import time
from collections import deque
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

import cv2
import numpy as np


class ScanState(str, Enum):
    """The states a scanning workspace shows the teacher."""

    WAITING = "WAITING"  # no paper visible
    DETECTED = "DETECTED"  # a page entered the area
    STABILIZING = "STABILIZING"  # page present but still moving
    READY = "READY"  # stable, readable, full page — hand to recognition
    PROCESSED = "PROCESSED"  # same page already triggered; suppress repeats
    QUALITY_INSUFFICIENT = "QUALITY_INSUFFICIENT"  # blurry / too dark / partial
    MULTIPLE_PAPERS = "MULTIPLE_PAPERS"  # overlapping or separate pages
    CAMERA_UNAVAILABLE = "CAMERA_UNAVAILABLE"  # device gone or not opened


@dataclass
class DetectorConfig:
    """All thresholds in one place — tunable per device and lighting."""

    sample_interval_s: float = 0.2  # sample the stream at 5 fps, not every frame
    min_area_fraction: float = 0.12  # paper must fill >=12% of the frame
    min_aspect: float = 0.42  # reject skinny slivers on both axes
    max_aspect: float = 2.4
    sharpness_floor: float = 35.0  # Laplacian variance (aligned with vision-service)
    underexposed_luminance: float = 60.0  # mean luminance floor for the page
    stability_frames: int = 3  # consecutive stable samples before READY
    stability_iou: float = 0.88  # bounds IoU between samples counts as "still"
    duplicate_iou: float = 0.90  # IoU with the processed page → duplicate
    leave_frames: int = 2  # consecutive empty samples before the desk is clear
    edge_margin_px: int = 4  # page touching frame edge = partial page
    min_contrast_ratio: float = 1.5  # page must be brighter than the desk median


@dataclass
class PaperRegion:
    """One detected page candidate with quality measurements."""

    x: int
    y: int
    w: int
    h: int
    area_fraction: float
    sharpness: float
    luminance: float
    touches_edge: bool


def iou(a: tuple[int, int, int, int], b: tuple[int, int, int, int]) -> float:
    """Intersection-over-union of two (x, y, w, h) boxes."""
    ax0, ay0, aw, ah = a
    bx0, by0, bw, bh = b
    ix0, iy0 = max(ax0, bx0), max(ay0, by0)
    ix1, iy1 = min(ax0 + aw, bx0 + bw), min(ay0 + ah, by0 + bh)
    inter = max(0, ix1 - ix0) * max(0, iy1 - iy0)
    union = aw * ah + bw * bh - inter
    return inter / union if union > 0 else 0.0


def detect_paper(frame: np.ndarray, cfg: DetectorConfig | None = None) -> list[PaperRegion]:
    """Finds likely page regions in one BGR frame (the cheap part — runs on
    sampled frames only). Returns candidates sorted by area, largest first."""
    cfg = cfg or DetectorConfig()
    frame_h, frame_w = frame.shape[:2]
    frame_area = float(frame_w * frame_h)

    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    frame_median = float(np.median(gray))
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    _, mask = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    regions: list[PaperRegion] = []
    for contour in contours:
        x, y, w, h = cv2.boundingRect(contour)
        area_fraction = (w * h) / frame_area
        if area_fraction < cfg.min_area_fraction:
            continue
        aspect = w / float(h)
        if not (cfg.min_aspect <= aspect <= cfg.max_aspect):
            continue
        margin = cfg.edge_margin_px
        touches = x <= margin or y <= margin or x + w >= frame_w - margin or y + h >= frame_h - margin
        roi = gray[y : y + h, x : x + w]
        sharpness = float(cv2.Laplacian(roi, cv2.CV_64F).var())
        luminance = float(roi.mean())
        # A page is a BRIGHT region on a darker desk. A candidate whose
        # luminance is close to the frame median is just the desk surface
        # split by Otsu on a vignette — reject it as a phantom.
        if luminance < frame_median * cfg.min_contrast_ratio:
            continue
        regions.append(PaperRegion(x, y, w, h, area_fraction, sharpness, luminance, touches))

    regions.sort(key=lambda r: r.w * r.h, reverse=True)
    return regions


@dataclass
class Diagnostics:
    """Enough numbers to reproduce a failure: state transitions and timings."""

    samples: int = 0
    ready_events: int = 0  # how many times the page became ready to process
    duplicates_suppressed: int = 0
    samples_to_ready: list[float] = field(default_factory=list)  # sample counts (× interval = time)
    transitions: list[tuple[float, str]] = field(default_factory=list)  # (t_s, state)

    def as_dict(self) -> dict[str, Any]:
        return {
            "samples": self.samples,
            "ready_events": self.ready_events,
            "duplicates_suppressed": self.duplicates_suppressed,
            "avg_samples_to_ready": (
                sum(self.samples_to_ready) / len(self.samples_to_ready) if self.samples_to_ready else None
            ),
            "transitions": [(round(t, 3), s) for t, s in self.transitions[-30:]],
        }


class PaperTracker:
    """State machine over sampled detection results.

    Feed one Observation per sampled frame (see main.py for the real-camera
    loop, synthetic_test.py for the headless harness). The tracker never
    touches recognition — "READY" only means the paper is stable and readable.
    """

    def __init__(self, cfg: DetectorConfig | None = None) -> None:
        self.cfg = cfg or DetectorConfig()
        self.state = ScanState.WAITING
        self.diagnostics = Diagnostics()
        self._t0 = time.monotonic()
        self._prev_bounds: tuple[int, int, int, int] | None = None
        self._stable_count = 0
        self._empty_count = 0
        self._processing_samples = 0  # samples since the page first appeared
        self._processed_bounds: tuple[int, int, int, int] | None = None

    def _set(self, state: ScanState) -> None:
        if state is not self.state:
            self.state = state
            self.diagnostics.transitions.append((time.monotonic() - self._t0, state.value))

    def observe(self, regions: list[PaperRegion] | None) -> ScanState:
        """Advance the state machine with one sampled frame.
        Pass None when the camera produced no frame (disconnect)."""
        cfg = self.cfg
        self.diagnostics.samples += 1

        if regions is None:
            self._set(ScanState.CAMERA_UNAVAILABLE)
            return self.state

        # Separate overlapping/adjacent candidates: anything distinct enough
        # from the largest region counts as a second paper on the desk.
        if len(regions) > 1:
            primary = regions[0]
            others = [
                r
                for r in regions[1:]
                if iou((r.x, r.y, r.w, r.h), (primary.x, primary.y, primary.w, primary.h)) < 0.5
            ]
            if others:
                self._set(ScanState.MULTIPLE_PAPERS)
                return self.state

        page = regions[0] if regions else None
        if page is None:
            self._empty_count += 1
            self._prev_bounds = None
            self._processing_samples = 0
            if self._empty_count >= cfg.leave_frames:
                self._processed_bounds = None  # desk is clear: forget the page
                self._set(ScanState.WAITING)
            elif self.state is not ScanState.PROCESSED:
                self._set(ScanState.WAITING)
            return self.state
        self._empty_count = 0
        self._processing_samples += 1

        bounds = (page.x, page.y, page.w, page.h)

        # Duplicate suppression: the same page, still in the same place, that
        # already triggered a processing event is not re-triggered.
        if (
            self._processed_bounds is not None
            and iou(bounds, self._processed_bounds) >= cfg.duplicate_iou
            and self._prev_bounds is not None
            and iou(bounds, self._prev_bounds) >= cfg.stability_iou
        ):
            if self.state is not ScanState.PROCESSED:
                self.diagnostics.duplicates_suppressed += 1
            self._set(ScanState.PROCESSED)
            return self.state

        if page.touches_edge:
            self._set(ScanState.QUALITY_INSUFFICIENT)  # partial page — teacher adjusts
            return self.state

        quality_ok = (
            page.sharpness >= cfg.sharpness_floor and page.luminance >= cfg.underexposed_luminance
        )
        if not quality_ok:
            self._stable_count = 0
            self._set(ScanState.QUALITY_INSUFFICIENT)
            return self.state

        still = self._prev_bounds is not None and iou(bounds, self._prev_bounds) >= cfg.stability_iou
        self._stable_count = self._stable_count + 1 if still else 1
        self._prev_bounds = bounds

        if self._stable_count >= cfg.stability_frames:
            if self.state is not ScanState.READY:
                self.diagnostics.ready_events += 1
                self.diagnostics.samples_to_ready.append(float(self._processing_samples))
            self._set(ScanState.READY)
            self._processed_bounds = bounds  # this placement has now triggered
            return self.state

        self._set(ScanState.STABILIZING if self._stable_count > 1 else ScanState.DETECTED)
        return self.state

    def reset_processed(self) -> None:
        """Teacher-controlled 'process this page again' (the R key / button)."""
        self._processed_bounds = None
