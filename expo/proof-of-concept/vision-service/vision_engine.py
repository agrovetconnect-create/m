"""
AI Mark Entry System — Vision Analysis Engine Pipeline (foundational script).

Pipeline stages:
    1. Quality     — frame check: is a paper document present, is the text
                     sharp (Laplacian variance) and well exposed (mean
                     luminance)? Severe motion blur, occlusion or dim frames
                     are flagged immediately as read_quality blur/underexposed
                     so the caller can ask for a retake instead of guessing.
    2. Preprocess  — grayscale, specular-highlight clip, bilateral denoise,
                     adaptive threshold (tuned for handwriting on paper)
    3. OCR         — pluggable text backend. Uses Tesseract (pytesseract) with
                     word-level confidence when installed; fails loudly with
                     OCR_BACKEND_UNAVAILABLE otherwise. No fake results.
    4. Parse       — identity (registration number), full name (label-anchored
                     "Name: …" read, any letter script) and mark ("earned/max")
                     via pattern matching with sanity checks (earned <= max).
                     Nothing else is detected — no people, hands, objects, food
                     or vegetation. This engine reads exam-paper text only.
    5. Gate        — confidence routing: below CONFIDENCE_FLOOR (0.75) or
                     missing fields → MANUAL_FALLBACK_REQUIRED. This function
                     NEVER returns a low-confidence result as savable.
                     detected_marks_count is a RAW mathematical count of the
                     marks evidenced on the paper (the credited count read off
                     a score annotation) — the engine never grades or
                     evaluates the student.

Real confidence metric: weighted mean of OCR word confidences for the tokens
that produced the extracted fields — not a simulated constant.

Usage:
    python vision_engine.py path/to/paper.jpg
    python vision_engine.py --demo-text "REG-2026-9843 ... 88 / 100" --confidence 0.89
"""

import argparse
import json
import re
import sys
import time
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np

try:
    import pytesseract
    TESSERACT_AVAILABLE = True
except ImportError:  # pragma: no cover - environment dependent
    TESSERACT_AVAILABLE = False

CONFIDENCE_FLOOR = 0.75

# Frame-quality thresholds (spec stage 1: flag bad captures immediately).
BLUR_VARIANCE_FLOOR = 35.0      # Laplacian variance below this → motion blur / defocus
UNDEREXPOSED_LUMINANCE = 60.0   # mean grayscale luminance below this → too dark
PAPER_AREA_FRACTION = 0.25      # largest bright component must cover ≥ 25% of the frame
PAPER_MIN_LUMINANCE = 25.0      # near-black frames can never contain a readable paper

# Identity candidates, most specific first. Tolerates dashes/spaces/typography.
IDENTITY_PATTERNS = [
    re.compile(r"\bREG[-–\s]?\d{4}[-–\s]?\d{4}\b"),          # REG-2026-9843
    re.compile(r"\b[A-Z]{2,4}[-/]\d{3,7}\b"),                # AB-12345 / CSE/2026
    re.compile(r"\b\d{2}[-/][A-Z]{2,4}[-/]\d{2,4}\b"),       # 24/CSE/012
]
MARK_PATTERN = re.compile(r"\b(\d{1,3})\s*/\s*(\d{1,3})\b")

# Full-name read: anchored to a "Name" label because a bare line of words is
# ambiguous on a marked exam page. The separator is optional so OCR variants
# like "Name - Dana", "Name:" and "Name Dana" all match. Words containing
# digits (IDs like REG-2026-9843) and section labels are never part of a name.
NAME_LABEL_PATTERN = re.compile(
    r"\b(?:full|student|candidate|pupil|exam)?\s*name\b\s*[:\-–]?\s*", re.IGNORECASE
)
NAME_WORD_PATTERN = re.compile(r"[^\W\d_][\w'’\-]*", re.UNICODE)
NAME_STOPWORDS = {
    "score", "scores", "mark", "marks", "class", "date", "subject", "total",
    "reg", "admission", "number", "no", "section", "term", "grade", "is", "the",
}


@dataclass
class WordToken:
    text: str
    confidence: float  # 0..1, from the OCR backend


@dataclass
class VisionResult:
    status: str                 # OK | ERROR
    action_routing: str         # EXECUTE_CONFIRMATION_PROMPT | MANUAL_FALLBACK_REQUIRED | ERROR
    confidence: float
    payload: Dict[str, Any] = field(default_factory=dict)
    error_code: Optional[str] = None

    def to_json(self) -> str:
        return json.dumps(asdict(self), indent=2)


class AdvancedVisionInferenceEngine:
    """Preprocess → OCR → parse → gate. Deterministic and side-effect free."""

    def __init__(self, confidence_floor: float = CONFIDENCE_FLOOR, ocr_lang: str = "eng"):
        self.confidence_floor = confidence_floor
        self.ocr_lang = ocr_lang

    # -- 1. Preprocessing ---------------------------------------------------

    def _preprocess(self, image: np.ndarray) -> np.ndarray:
        """Cleans glare, shadows and sensor noise; binarizes for OCR.

        Block size 31 / C 15 outperforms the textbook 11/2 for full-page
        handwriting: 11/2 shreds thin pencil strokes into speckle.
        """
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

        # Clip specular highlights (glare from phone flash) before filtering.
        gray = cv2.min(gray, 245)

        # Upscale small captures — OCR accuracy drops sharply under ~1000px.
        if min(gray.shape[:2]) < 1000:
            scale = 2.0
            gray = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)

        denoised = cv2.bilateralFilter(gray, 9, 75, 75)  # edge-preserving denoise
        binary = cv2.adaptiveThreshold(
            denoised, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 15
        )
        return binary

    # -- 1b. Frame quality ---------------------------------------------------

    def _assess_quality(self, image: np.ndarray) -> Dict[str, Any]:
        """Stage-1 quality check: paper boundary, sharpness and exposure.

        Paper detection: Otsu-binarize a lightly blurred grayscale frame and
        take the largest bright connected component — a document held in front
        of the camera dominates the frame, while background clutter stays
        fragmented. Mitigates dynamic shadows via the Gaussian pre-blur.
        """
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        if min(gray.shape[:2]) > 640:
            scale = 640.0 / min(gray.shape[:2])
            gray = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
        blurred = cv2.GaussianBlur(gray, (5, 5), 0)
        sharpness = float(cv2.Laplacian(blurred, cv2.CV_64F).var())
        mean_luminance = float(gray.mean())
        _, bw = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        count, _, stats, _ = cv2.connectedComponentsWithStats(bw.astype(np.uint8), connectivity=8)
        largest_idx, largest = 0, 0
        for i in range(1, count):
            area = int(stats[i, cv2.CC_STAT_AREA])
            if area > largest:
                largest, largest_idx = area, i
        paper_fraction = largest / float(bw.shape[0] * bw.shape[1])
        paper_detected = paper_fraction >= PAPER_AREA_FRACTION and mean_luminance > PAPER_MIN_LUMINANCE
        # Normalized paper bounds (0..1, top-left origin) of the detected
        # document — the app draws its live bounding-box overlay from these.
        paper_bounds = None
        if paper_detected and largest > 0:
            paper_bounds = {
                "x": round(float(stats[largest_idx, cv2.CC_STAT_LEFT]) / bw.shape[1], 4),
                "y": round(float(stats[largest_idx, cv2.CC_STAT_TOP]) / bw.shape[0], 4),
                "w": round(float(stats[largest_idx, cv2.CC_STAT_WIDTH]) / bw.shape[1], 4),
                "h": round(float(stats[largest_idx, cv2.CC_STAT_HEIGHT]) / bw.shape[0], 4),
            }
        if mean_luminance < UNDEREXPOSED_LUMINANCE:
            read_quality = "underexposed"
        elif sharpness < BLUR_VARIANCE_FLOOR:
            read_quality = "blurry"
        else:
            read_quality = "clear"
        return {"paper_detected": paper_detected, "read_quality": read_quality, "paper_bounds": paper_bounds}

    # -- 2. OCR -------------------------------------------------------------

    def _run_ocr(self, image: np.ndarray) -> List[WordToken]:
        if not TESSERACT_AVAILABLE:
            raise RuntimeError(
                "OCR_BACKEND_UNAVAILABLE: install the Tesseract engine "
                "(apt-get install tesseract-ocr) and the pytesseract package."
            )
        data = pytesseract.image_to_data(
            image,
            lang=self.ocr_lang,
            config="--psm 6",  # assume a uniform block of text (exam page)
            output_type=pytesseract.Output.DICT,
        )
        tokens: List[WordToken] = []
        for text, conf in zip(data["text"], data["conf"]):
            text = text.strip()
            confidence = float(conf)
            if text and confidence >= 0:
                tokens.append(WordToken(text=text, confidence=confidence / 100.0))
        return tokens

    # -- 3. Parsing ---------------------------------------------------------

    def _weighted_confidence(self, tokens: List[WordToken], used: List[int]) -> float:
        """Mean OCR confidence of the words that produced the extraction."""
        if not used:
            return 0.0
        relevant = [tokens[i].confidence for i in used]
        return sum(relevant) / len(relevant)

    def _extract_identity(self, text: str, tokens: List[WordToken]) -> Tuple[Optional[str], List[int]]:
        for pattern in IDENTITY_PATTERNS:
            match = pattern.search(text)
            if match:
                return match.group(0), self._token_indices_for_span(tokens, match.start(), match.end())
        return None, []

    def _extract_full_name(self, text: str, tokens: List[WordToken]) -> Tuple[Optional[str], List[int]]:
        """Label-anchored full-name read ("Name: Amina Yusuf", any letter script).

        Best-effort by design: unlike the ID and the mark, a missing name does
        NOT gate the read (see _gate) — it only enriches the confirmation
        prompt and the app's roster matching.
        """
        for label in NAME_LABEL_PATTERN.finditer(text):
            segment = re.split(r"[:\n]", text[label.end():])[0]
            words = [w for w in NAME_WORD_PATTERN.findall(segment) if not any(ch.isdigit() for ch in w)]
            words = [w for w in words if w.lower() not in NAME_STOPWORDS]
            if not words or len(words) > 4:
                continue
            name = " ".join(words)
            if len(name) < 3:
                continue
            start = text.find(words[0], label.end())
            end = text.find(words[-1], start) + len(words[-1])
            return name, self._token_indices_for_span(tokens, start, end)
        return None, []

    def _extract_score(self, text: str, tokens: List[WordToken]) -> Tuple[Optional[str], List[int]]:
        """First 'earned/max' match that passes the sanity check (earned <= max)."""
        for match in MARK_PATTERN.finditer(text):
            earned, maximum = int(match.group(1)), int(match.group(2))
            if 0 < maximum <= 1000 and earned <= maximum:
                return f"{earned}/{maximum}", self._token_indices_for_span(tokens, match.start(), match.end())
        return None, []

    @staticmethod
    def _token_indices_for_span(tokens: List[WordToken], start: int, end: int) -> List[int]:
        """Maps a regex span in the joined text back to OCR word indices."""
        cursor, indices = 0, []
        for i, token in enumerate(tokens):
            nxt = cursor + len(token.text) + 1
            if nxt > start and cursor < end:
                indices.append(i)
            cursor = nxt
        return indices

    # -- 4. Gate ------------------------------------------------------------

    def _gate(self, tokens: List[WordToken], identity: Optional[str], identity_indices: List[int],
              score: Optional[str], score_indices: List[int],
              name: Optional[str] = None, name_indices: Optional[List[int]] = None,
              page_confidence: Optional[float] = None,
              quality: Optional[Dict[str, Any]] = None,
              latency_ms: int = 0) -> VisionResult:
        # The name is confirmatory, not gating: ID + marks decide the route.
        used = identity_indices + score_indices + (name_indices or [])
        field_confidence = self._weighted_confidence(tokens, used)
        if not used and page_confidence is not None:
            # Text-only path (demo / ML Kit bridging): no token mapping exists,
            # so trust the OCR backend's own page confidence instead of 0.0.
            field_confidence = page_confidence
        reasons: List[str] = []
        if not tokens:
            reasons.append("NO_TEXT_DETECTED")
        if identity is None:
            reasons.append("IDENTITY_UNREADABLE")
        if score is None:
            reasons.append("MARK_UNREADABLE")
        if tokens and field_confidence < self.confidence_floor:
            reasons.append(f"LOW_CONFIDENCE_{field_confidence:.2f}_BELOW_FLOOR_{self.confidence_floor:.2f}")

        # detected_marks_count is a raw count of the marks evidenced on the
        # paper (the credited count of a "earned/max" score annotation) — a
        # mathematical count, never a grade or evaluation of the student.
        marks_count = 0
        if score:
            m = MARK_PATTERN.search(score)
            if m:
                marks_count = int(m.group(1))
        frame_meta = {
            "paper_detected": bool((quality or {}).get("paper_detected", False)),
            "read_quality": (quality or {}).get("read_quality", "blurry"),
            "paper_bounds": (quality or {}).get("paper_bounds"),
            "latency_ms": int(latency_ms),
            "detected_marks_count": marks_count,
        }

        if reasons:
            # Human-in-the-loop checkpoint: never return a savable low-confidence guess.
            return VisionResult(
                status="OK",
                action_routing="MANUAL_FALLBACK_REQUIRED",
                confidence=round(field_confidence, 4),
                payload={
                    "extracted_identity": identity or "UNREADABLE",
                    "extracted_full_name": name,
                    "extracted_score": score or "UNREADABLE",
                    "flag_reason": "; ".join(reasons),
                    **frame_meta,
                },
            )

        return VisionResult(
            status="OK",
            action_routing="EXECUTE_CONFIRMATION_PROMPT",
            confidence=round(field_confidence, 4),
            payload={"identity": identity, "full_name": name, "score": score, **frame_meta},
        )

    # -- Public entry points -------------------------------------------------

    def process_captured_frame(self, frame_binary_path: str) -> Dict[str, Any]:
        image = cv2.imread(frame_binary_path)
        if image is None:
            return asdict(VisionResult(status="ERROR", action_routing="ERROR", confidence=0.0,
                                       error_code="FRAME_UNREADABLE"))
        return self.process_image_array(image)

    def process_image_array(self, image: np.ndarray) -> Dict[str, Any]:
        started = time.perf_counter()
        try:
            quality = self._assess_quality(image)
            preprocessed = self._preprocess(image)
            tokens = self._run_ocr(preprocessed)
        except RuntimeError as exc:
            return asdict(VisionResult(status="ERROR", action_routing="ERROR", confidence=0.0,
                                       error_code=str(exc)))
        latency_ms = int((time.perf_counter() - started) * 1000)
        text = " ".join(t.text for t in tokens)
        identity, identity_idx = self._extract_identity(text, tokens)
        name, name_idx = self._extract_full_name(text, tokens)
        score, score_idx = self._extract_score(text, tokens)
        return asdict(self._gate(tokens, identity, identity_idx, score, score_idx, name, name_idx,
                                 quality=quality, latency_ms=latency_ms))

    def process_ocr_text(self, text: str, ocr_confidence: float) -> Dict[str, Any]:
        """Gate-only path for pre-extracted text (demo mode / ML Kit bridging).
        The confidence argument is the OCR backend's own page confidence."""
        tokens = [WordToken(text=word, confidence=ocr_confidence) for word in text.split()]
        identity, _ = self._extract_identity(text, tokens)
        name, _ = self._extract_full_name(text, tokens)
        score, _ = self._extract_score(text, tokens)
        # Text-only bridging path: the frame itself was not inspected, so the
        # paper is presumed present and sharp with no measured bounds; no pixel
        # inference ran (0 ms).
        return asdict(self._gate(tokens, identity, [], score, [], name, [],
                                 page_confidence=ocr_confidence,
                                 quality={"paper_detected": True, "read_quality": "clear", "paper_bounds": None},
                                 latency_ms=0))


def main() -> int:
    parser = argparse.ArgumentParser(description="AI Mark Entry vision pipeline")
    parser.add_argument("image", nargs="?", help="path to the captured page image")
    parser.add_argument("--demo-text", dest="demo_text", help="gate-only demo on OCR text (no image needed)")
    parser.add_argument("--confidence", dest="confidence", type=float, default=0.89,
                        help="OCR page confidence for --demo-text (0..1)")
    parser.add_argument("--floor", dest="floor", type=float, default=CONFIDENCE_FLOOR)
    args = parser.parse_args()

    engine = AdvancedVisionInferenceEngine(confidence_floor=args.floor)

    if args.demo_text:
        print("[DEMO MODE] gate-only evaluation of provided text — not an OCR result")
        print(engine.process_ocr_text(args.demo_text, max(0.0, min(1.0, args.confidence))))
        return 0

    if not args.image:
        parser.error("provide an image path or --demo-text")
    print(engine.process_captured_frame(args.image))
    return 0


if __name__ == "__main__":
    sys.exit(main())
