"""Synthetic frame generation for camera-free testing.

Every frame is a deterministic "desk scene": a dark textured desk with an
optional bright page drawn at a given bounding box, optional "printed" text
lines, blur, and a brightness factor. This lets the detector's logic be
measured with ground truth (we know exactly where the paper is) without any
camera hardware — no fake recognition results, only real pixel processing.
"""

import cv2
import numpy as np

DESK_SIZE = (960, 720)  # (width, height) of synthetic frames


def make_desk(seed: int = 0, brightness: float = 1.0) -> np.ndarray:
    """A dark desk background with mild texture and vignette."""
    rng = np.random.default_rng(seed)
    h, w = DESK_SIZE[1], DESK_SIZE[0]
    frame = rng.integers(28, 58, size=(h, w), dtype=np.uint8)
    # Vignette: darker toward the edges, like a real overhead camera.
    yy, xx = np.mgrid[0:h, 0:w]
    vign = 1.0 - 0.35 * (((xx - w / 2) / (w / 2)) ** 2 + ((yy - h / 2) / (h / 2)) ** 2)
    frame = (frame.astype(np.float32) * vign).astype(np.uint8)
    frame = (frame.astype(np.float32) * brightness).clip(0, 255).astype(np.uint8)
    return cv2.cvtColor(frame, cv2.COLOR_GRAY2BGR)


def draw_page(
    frame: np.ndarray,
    bbox: tuple[int, int, int, int],
    brightness: float = 1.0,
    text_lines: int = 6,
) -> np.ndarray:
    """Draws a bright page with faint 'text' rows at bbox = (x, y, w, h)."""
    out = frame.copy()
    x, y, w, h = bbox
    cv2.rectangle(out, (x, y), (x + w, y + h), (245, 245, 245), -1)
    rng = np.random.default_rng(w * 100003 + h)
    row_h = h // (text_lines + 2)
    for i in range(text_lines):
        y0 = y + row_h * (i + 1) + row_h // 3
        x0 = x + w // 10
        x1 = x + w - w // 10 - int(rng.integers(0, w // 3))
        cv2.rectangle(out, (x0, y0), (max(x0 + 4, x1), y0 + max(2, row_h // 6)), (70, 70, 70), -1)
    if brightness != 1.0:
        base = out.astype(np.float32)
        paper_mask = np.zeros(out.shape[:2], np.float32)
        cv2.rectangle(paper_mask, (x, y), (x + w, y + h), 1.0, -1)
        paper_mask = cv2.GaussianBlur(paper_mask, (31, 31), 0)
        blended = base * (1 - paper_mask[..., None]) + base * brightness * paper_mask[..., None]
        out = blended.clip(0, 255).astype(np.uint8)
    return out


def blur_frame(frame: np.ndarray, sigma: float) -> np.ndarray:
    """Gaussian blur approximating an out-of-focus capture."""
    if sigma <= 0:
        return frame
    k = int(sigma * 4) | 1
    return cv2.GaussianBlur(frame, (k, k), sigma)


def scenario_frame(
    page: tuple[int, int, int, int] | None,
    *,
    brightness: float = 1.0,
    sigma: float = 0.0,
    seed: int = 0,
) -> np.ndarray:
    """One synthetic camera frame: desk + optional page + optics."""
    frame = make_desk(seed=seed, brightness=brightness)
    if page is not None:
        frame = draw_page(frame, page, brightness=brightness)
    return blur_frame(frame, sigma)
