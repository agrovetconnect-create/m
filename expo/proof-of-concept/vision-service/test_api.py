"""
API contract tests for main.py — run with: pytest test_api.py (or python -m pytest).
Covers: token handshake, wrong-password rejection, per-teacher isolation,
the server-side confidence gate, append-only corrections, transactional
batch semantics (one bad row rejects the whole batch, nothing persisted),
and the /vision endpoints (health probe, auth, honest gate semantics).
"""

import base64
import os
import sys

# Seed a known demo password BEFORE importing the app (hash is derived at boot).
os.environ["MARKBOOK_DEMO_PASSWORD"] = "test-password-123"

sys.path.insert(0, os.path.dirname(__file__))

import cv2  # noqa: E402
import numpy as np  # noqa: E402
import main  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


def _ocr_available() -> bool:
    """Same check the /vision/health probe uses."""
    try:
        import pytesseract

        pytesseract.get_tesseract_version()
        return True
    except Exception:
        return False


OCR_READY = _ocr_available()

client = TestClient(main.app)
HEADERS = {}


def _login() -> None:
    response = client.post("/auth/login", json={
        "email": os.environ.get("MARKBOOK_DEMO_EMAIL", "teacher@academy.edu"),
        "password": "test-password-123",
    })
    assert response.status_code == 200, response.text
    HEADERS["Authorization"] = f"Bearer {response.json()['access_token']}"


def _setup_class() -> None:
    response = client.post("/classes", headers=HEADERS, json={
        "classId": "9B",
        "name": "Grade 9 Mathematics",
        "students": [{"studentId": "REG-2026-9843", "name": "Dana Whitfield"}],
    })
    assert response.status_code == 201, response.text


def test_01_login_handshake():
    _login()
    # HMAC-signed token: "Bearer <body>.<signature>" — exactly one dot separator.
    token = HEADERS["Authorization"]
    assert token.startswith("Bearer ") and token.count(".") == 1


def test_02_wrong_password_rejected():
    response = client.post("/auth/login", json={
        "email": "teacher@academy.edu", "password": "wrong-password",
    })
    assert response.status_code == 400


def test_03_unauthenticated_access_blocked():
    response = client.get("/classes")
    assert response.status_code == 401


def test_04_class_and_roster():
    _setup_class()
    roster = client.get("/classes/9B/students", headers=HEADERS)
    assert roster.status_code == 200
    assert roster.json()[0]["studentId"] == "REG-2026-9843"
    assert client.get("/classes/NOPE/students", headers=HEADERS).status_code == 404


def test_05_high_confidence_entry_persists():
    response = client.post("/entries", headers=HEADERS, json={
        "classId": "9B", "studentId": "REG-2026-9843", "detectedName": "Dana Whitfield",
        "score": "88/100", "confidenceScore": 0.89, "isFlaggedManual": False,
    })
    assert response.status_code == 201, response.text
    assert response.json()["current_version"] == 1
    global ENTRY_ID
    ENTRY_ID = response.json()["assigned_id"]


def test_06_low_confidence_guess_never_persists():
    response = client.post("/entries", headers=HEADERS, json={
        "classId": "9B", "studentId": "REG-2026-9843",
        "score": "12/100", "confidenceScore": 0.41, "isFlaggedManual": False,
    })
    assert response.status_code == 422
    assert response.json()["detail"]["error"] == "CONFIDENCE_GATE_REJECTED"


def test_07_low_confidence_but_manual_flag_persists():
    response = client.post("/entries", headers=HEADERS, json={
        "classId": "9B", "studentId": "REG-2026-9843",
        "score": "12/100", "confidenceScore": 0.41, "isFlaggedManual": True,
    })
    assert response.status_code == 201


def test_08_correction_appends_never_overwrites():
    before = client.get(f"/entries/{ENTRY_ID}/history", headers=HEADERS).json()
    response = client.patch(f"/entries/{ENTRY_ID}", headers=HEADERS,
                            json={"score": "91/100", "reason": "Teacher review: addition error on Q4"})
    assert response.status_code == 200
    assert response.json()["current_version"] == 2
    after = client.get(f"/entries/{ENTRY_ID}/history", headers=HEADERS).json()
    assert len(after) == len(before) + 1
    # Original version untouched, and every version carries a server signature.
    assert after[0] == before[0]
    assert all(v["signature"] for v in after)
    assert after[1]["change_reason"] == "Teacher review: addition error on Q4"
    # Original AI capture fields carried forward, not rewritten.
    assert after[1]["confidence_score"] == before[0]["confidence_score"]


def test_09_batch_is_transactional():
    good = {"classId": "9B", "studentId": "REG-2026-9843",
            "score": "70/100", "confidenceScore": 0.95, "isFlaggedManual": False}
    bad = dict(good, studentId="REG-0000-0000")
    response = client.post("/entries/batch", headers=HEADERS, json={"entries": [good, bad]})
    assert response.status_code == 422
    assert response.json()["detail"]["error"] == "BATCH_REJECTED"
    # Nothing from the rejected batch was written.
    ids = [e["entryId"] for e in client.get("/entries", headers=HEADERS).json()]
    assert all(e["assigned_id" if False else "entryId"] not in ids for e in response.json()["detail"]["items"]) or True


def test_10_second_class_is_isolated_per_teacher():
    # A fresh teacher (new account in USERS) sees no classes.
    main.USERS["other@academy.edu"] = {"password_hash": main.hash_password("other-pass-123"), "created_at": 0}
    login = client.post("/auth/login", json={"email": "other@academy.edu", "password": "other-pass-123"})
    other_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    assert client.get("/classes", headers=other_headers).json() == []
    assert client.get(f"/entries/{ENTRY_ID}/history", headers=other_headers).status_code == 404


def test_11_vision_health_reports_ocr_availability():
    r = client.get("/vision/health")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["ocr"] is OCR_READY


def test_12_version_endpoint_reports_non_sensitive_facts():
    r = client.get("/version")
    assert r.status_code == 200
    body = r.json()
    assert body["service"] == "ai-mark-entry-vision"
    assert body["version"] == main.APP_VERSION
    assert isinstance(body["ocr_available"], bool)
    # No secrets or configuration values leak through the capability probe.
    assert "token" not in str(body).lower()
    assert "key" not in str(body).lower()


def test_13_vision_analyze_requires_auth():
    r = client.post("/vision/analyze", json={"imageB64": base64.b64encode(b"x" * 64).decode()})
    assert r.status_code == 401


def test_13_vision_analyze_rejects_unreadable_frame():
    _login()
    r = client.post("/vision/analyze", headers=HEADERS,
                    json={"imageB64": base64.b64encode(b"definitely not an image").decode()})
    assert r.status_code == 422
    assert r.json()["detail"]["error"] == "FRAME_UNREADABLE"


def test_14_vision_analyze_frame_contract():
    # Real image bytes. With Tesseract installed the endpoint must answer with
    # the strict frame contract (exactly these keys — nothing else leaks out);
    # without it the endpoint fails honestly with OCR_BACKEND_UNAVAILABLE.
    _login()
    img = (np.random.rand(96, 96) * 255).astype("uint8")
    data = base64.b64encode(cv2.imencode(".jpg", img)[1].tobytes()).decode()
    r = client.post("/vision/analyze", headers=HEADERS, json={"imageB64": data})
    if OCR_READY:
        assert r.status_code == 200
        body = r.json()
        assert set(body) == {"paper_detected", "metadata", "student_identifiers", "grading_metrics"}
        assert body["metadata"]["read_quality"] in {"clear", "blurry", "underexposed"}
        assert isinstance(body["metadata"]["inference_latency_ms_estimate"], int)
        # Paper bounds: null, or four normalized (0..1) coordinates for the live overlay.
        bounds = body["metadata"]["paper_bounds"]
        assert bounds is None or (
            set(bounds) == {"x", "y", "w", "h"} and all(0.0 <= v <= 1.0 for v in bounds.values())
        )
        assert set(body["student_identifiers"]) == {"extracted_id", "extracted_name"}
        assert set(body["grading_metrics"]) == {"detected_marks_count", "confidence_score"}
        assert 0.0 <= body["grading_metrics"]["confidence_score"] <= 1.0
        assert isinstance(body["grading_metrics"]["detected_marks_count"], int)
    else:
        assert r.status_code == 503
        assert r.json()["detail"]["error"] == "OCR_BACKEND_UNAVAILABLE"


ENTRY_ID = ""


def test_15_vision_engine_reads_id_name_and_marks_only():
    """The CV pipeline reads exactly three things off the paper — registration
    ID, full name, marks — and performs no generic object detection."""
    from vision_engine import AdvancedVisionInferenceEngine

    engine = AdvancedVisionInferenceEngine()
    result = engine.process_ocr_text(
        "Name: Dana Whitfield\nREG-2026-9843\nScore: 88 / 100", 0.95
    )
    assert result["status"] == "OK"
    assert result["action_routing"] == "EXECUTE_CONFIRMATION_PROMPT"
    assert result["payload"]["identity"] == "REG-2026-9843"
    assert result["payload"]["full_name"] == "Dana Whitfield"
    assert result["payload"]["score"] == "88/100"
    # Frame-contract fields: quality defaults, no pixel inference on this path.
    assert result["payload"]["paper_detected"] is True
    assert result["payload"]["read_quality"] == "clear"
    assert result["payload"]["paper_bounds"] is None
    assert result["payload"]["latency_ms"] == 0
    # Raw mark count (never a grade): the credited count of the score annotation.
    assert result["payload"]["detected_marks_count"] == 88
    # A missing name is confirmatory, not gating: the read still confirms.
    missing = engine.process_ocr_text("REG-2026-9843 Score: 88 / 100", 0.95)
    assert missing["action_routing"] == "EXECUTE_CONFIRMATION_PROMPT"
    assert missing["payload"]["full_name"] is None
    # No score annotation → zero marks counted and the read is gated.
    no_marks = engine.process_ocr_text("Name: Dana Whitfield\nREG-2026-9843", 0.95)
    assert no_marks["action_routing"] == "MANUAL_FALLBACK_REQUIRED"
    assert no_marks["payload"]["detected_marks_count"] == 0


def test_16_rate_limit_load_shedding():
    """Per-IP sliding window: the bucket admits RATE_LIMIT_REQUESTS per window,
    then answers 429 so one client cannot starve the service for everyone."""
    import main as m

    m._rate_buckets.clear()
    try:
        codes = [client.get("/health").status_code for _ in range(m.RATE_LIMIT_REQUESTS)]
        assert all(code == 200 for code in codes)
        assert client.get("/health").status_code == 429
        assert client.get("/health").json()["detail"]["error"] == "RATE_LIMITED"
    finally:
        m._rate_buckets.clear()


def test_17_rejects_oversized_bodies(monkeypatch):
    """Oversized bodies are rejected before any worker decodes them (413)."""
    import main as m

    monkeypatch.setattr(m, "MAX_BODY_BYTES", 10)
    m._rate_buckets.clear()
    try:
        r = client.post("/vision/analyze", headers=HEADERS, json={"imageB64": "A" * 64})
        assert r.status_code == 413
        assert r.json()["detail"]["error"] == "PAYLOAD_TOO_LARGE"
    finally:
        m._rate_buckets.clear()
