"""
AI Mark Entry System — Secure Core API Backend (single-file production module).

FastAPI execution layer implementing:
  * PBKDF2-HMAC-SHA256 password hashing (no plaintext comparison, ever)
  * HMAC-signed, expiring access + refresh tokens (stateless, tamper-proof)
  * Strict per-teacher data isolation (every registry is keyed by token subject)
  * Transactional batch ingest (all-or-nothing — one bad row rejects the batch)
  * Server-side confidence gate: entries below CONFIDENCE_FLOOR are rejected
    unless explicitly flagged as manual, so a low-confidence guess can never
    be persisted even by a buggy client
  * Append-only, HMAC-signed audit ledger: corrections append a new version;
    no delete or overwrite route exists anywhere in this module

Deployment:
    uvicorn main:app --host 0.0.0.0 --port 8000
Environment variables:
    MARKBOOK_SERVER_SECRET   HMAC secret for token signing + record signatures
                             (REQUIRED in production; dev fallback is random per boot)
    MARKBOOK_DEMO_EMAIL      seeded demo teacher (default teacher@academy.edu)
    MARKBOOK_DEMO_PASSWORD   seeded demo password (default change-me-immediately)
    MARKBOOK_CORS_ORIGINS    comma-separated origins (default "*")

The in-memory registries are intentionally swappable: `_persist()` / `_load()`
are the single integration points for a Postgres/Redis driver.
"""

import asyncio
import base64
import hashlib
import hmac
import json
import os
import re
import time
import uuid
from collections import defaultdict, deque
from typing import Any, Dict, List, Optional, Tuple

import uvicorn
from fastapi import Depends, FastAPI, HTTPException, Request, Security, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, Field, field_validator

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

APP_VERSION = "1.0.0"
ACCESS_TTL_SECONDS = 60 * 60 * 8          # 8 hours
REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30   # 30 days
CONFIDENCE_FLOOR = 0.75                   # spec: below this → manual checkpoint
PBKDF2_ITERATIONS = 240_000
MAX_BATCH_ITEMS = 200
MAX_LEDGER_ENTRIES_PER_USER = 10_000

# Abuse protection / load shedding (env-tunable)
RATE_LIMIT_REQUESTS = int(os.environ.get("MARKBOOK_RATE_LIMIT_REQUESTS", "120"))
RATE_LIMIT_WINDOW_S = float(os.environ.get("MARKBOOK_RATE_LIMIT_WINDOW_S", "60"))
MAX_BODY_BYTES = int(os.environ.get("MARKBOOK_MAX_BODY_BYTES", str(10 * 1024 * 1024)))
VISION_TIMEOUT_SECONDS = float(os.environ.get("MARKBOOK_VISION_TIMEOUT_S", "30"))
MAX_CONCURRENT_VISION = int(os.environ.get("MARKBOOK_VISION_MAX_CONCURRENCY", "2"))

SERVER_SECRET: bytes = os.environ.get("MARKBOOK_SERVER_SECRET", "").encode() or os.urandom(32)
DEMO_EMAIL = os.environ.get("MARKBOOK_DEMO_EMAIL", "teacher@academy.edu")
DEMO_PASSWORD = os.environ.get("MARKBOOK_DEMO_PASSWORD", "change-me-immediately")
CORS_ORIGINS = [o.strip() for o in os.environ.get("MARKBOOK_CORS_ORIGINS", "*").split(",")]

SCORE_PATTERN = re.compile(r"^\s*(\d{1,3})\s*/\s*(\d{1,3})\s*$")
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# ---------------------------------------------------------------------------
# Password hashing — PBKDF2-HMAC-SHA256 (stdlib only, no plaintext comparison)
# ---------------------------------------------------------------------------


def hash_password(password: str) -> str:
    """Returns '<salt_b64>$<dk_b64>' using a 16-byte random salt."""
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ITERATIONS)
    return f"{base64.b64encode(salt).decode()}${base64.b64encode(dk).decode()}"


def verify_password(password: str, stored: str) -> bool:
    """Constant-time verification; malformed stored hashes verify as False."""
    try:
        salt_b64, dk_b64 = stored.split("$", 1)
        salt = base64.b64decode(salt_b64)
        expected = base64.b64decode(dk_b64)
    except (ValueError, TypeError):
        return False
    actual = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ITERATIONS)
    return hmac.compare_digest(actual, expected)


# ---------------------------------------------------------------------------
# Token minting / verification — HMAC-signed JSON payload (JWT-shaped, stdlib)
# ---------------------------------------------------------------------------


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _b64url_decode(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def mint_token(subject: str, kind: str, ttl_seconds: int) -> str:
    payload = {"sub": subject, "kind": kind, "exp": time.time() + ttl_seconds, "jti": uuid.uuid4().hex}
    body = _b64url(json.dumps(payload, separators=(",", ":")).encode())
    signature = _b64url(hmac.new(SERVER_SECRET, body.encode(), hashlib.sha256).digest())
    return f"{body}.{signature}"


def verify_token(token: str, expected_kind: str) -> str:
    """Returns the token subject (teacher email) or raises HTTP 401."""
    try:
        body, signature = token.split(".", 1)
        expected_sig = hmac.new(SERVER_SECRET, body.encode(), hashlib.sha256).digest()
        if not hmac.compare_digest(expected_sig, _b64url_decode(signature)):
            raise ValueError("bad signature")
        payload = json.loads(_b64url_decode(body))
    except (ValueError, TypeError, json.JSONDecodeError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Malformed session token.")
    if payload.get("kind") != expected_kind:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Wrong token type for this endpoint.")
    if float(payload.get("exp", 0)) < time.time():
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session token expired — refresh required.")
    subject = payload.get("sub")
    if not subject or subject not in USERS:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unknown session subject.")
    return subject


# ---------------------------------------------------------------------------
# Persistence layer (in-memory simulation stores, keyed by teacher email)
# ---------------------------------------------------------------------------

USERS: Dict[str, Dict[str, Any]] = {}                 # email -> {password_hash, created_at}
CLASSES: Dict[str, Dict[str, Dict[str, Any]]] = {}    # email -> class_id -> class record
STUDENTS: Dict[str, Dict[str, Dict[str, Any]]] = {}   # email -> class_id -> student_id -> roster item
LEDGER: Dict[str, Dict[str, List[Dict[str, Any]]]] = {}  # email -> entry_id -> [version, ...]


def _persist() -> None:
    """Integration point: flush registries to durable storage (Postgres/Redis)."""
    return None


def _load() -> None:
    """Integration point: hydrate registries from durable storage at boot."""
    USERS[DEMO_EMAIL] = {"password_hash": hash_password(DEMO_PASSWORD), "created_at": time.time()}


_load()

# ---------------------------------------------------------------------------
# Pydantic structural contract schemas (pydantic v2)
# ---------------------------------------------------------------------------


class LoginPayload(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    email: str = Field(..., pattern=EMAIL_PATTERN.pattern, examples=["teacher@academy.edu"])
    password: str = Field(..., min_length=8, examples=["change-me-immediately"])


class RefreshPayload(BaseModel):
    refresh_token: str = Field(..., min_length=20)


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int = ACCESS_TTL_SECONDS


class StudentRosterItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    student_id: str = Field(..., alias="studentId", min_length=1)
    name: str = Field(..., min_length=1)


class ClassSetupPayload(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    class_id: str = Field(..., alias="classId", min_length=1)
    name: str = Field(..., min_length=1)
    students: List[StudentRosterItem] = []


class MarkEntryInbound(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    class_id: str = Field(..., alias="classId", min_length=1)
    student_id: str = Field(..., alias="studentId", min_length=1)
    detected_name: Optional[str] = Field(None, alias="detectedName")
    score: str = Field(..., description="Mark string in 'earned/max' form, e.g. '88/100'")
    confidence_score: float = Field(..., alias="confidenceScore", ge=0.0, le=1.0)
    is_flagged_manual: bool = Field(..., alias="isFlaggedManual")
    device_id: Optional[str] = Field(None, alias="deviceId")

    @field_validator("score")
    @classmethod
    def score_shape(cls, v: str) -> str:
        m = SCORE_PATTERN.match(v)
        if not m:
            raise ValueError("score must match 'earned/max', e.g. 88/100")
        earned, maximum = int(m.group(1)), int(m.group(2))
        if maximum <= 0 or earned > maximum:
            raise ValueError("score earned must be within 0..max and max must be positive")
        return f"{earned}/{maximum}"


class MarkEntryBatchPayload(BaseModel):
    entries: List[MarkEntryInbound] = Field(..., min_length=1, max_length=MAX_BATCH_ITEMS)


class CorrectionPayload(BaseModel):
    score: str = Field(..., description="Corrected mark string in 'earned/max' form")
    reason: str = Field(..., min_length=3, description="Required audit note for the version increment")

    @field_validator("score")
    @classmethod
    def score_shape(cls, v: str) -> str:
        m = SCORE_PATTERN.match(v)
        if not m:
            raise ValueError("score must match 'earned/max', e.g. 88/100")
        earned, maximum = int(m.group(1)), int(m.group(2))
        if maximum <= 0 or earned > maximum:
            raise ValueError("score earned must be within 0..max and max must be positive")
        return f"{earned}/{maximum}"


# ---------------------------------------------------------------------------
# Security dependencies
# ---------------------------------------------------------------------------

bearer = HTTPBearer(auto_error=False)


def current_teacher(credentials: HTTPAuthorizationCredentials = Security(bearer)) -> str:
    """Resolves the Authorization bearer token to its teacher identity.

    Unlike a shared-token check, this returns the *actual* subject embedded in
    the signed token, so every registry lookup below is scoped per teacher.
    """
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authorization bearer token missing.")
    return verify_token(credentials.credentials, "access")


def sign_version(subject: str, entry_id: str, version: Dict[str, Any]) -> str:
    """HMAC signature over the canonical version payload — tamper evidence."""
    canonical = json.dumps({"subject": subject, "entry_id": entry_id, "version": version},
                           sort_keys=True, separators=(",", ":"))
    return hmac.new(SERVER_SECRET, canonical.encode(), hashlib.sha256).hexdigest()


def _validate_entry(subject: str, entry: MarkEntryInbound) -> None:
    """Shared validation for single and batch ingest. Raises HTTP 422."""
    if entry.confidence_score < CONFIDENCE_FLOOR and not entry.is_flagged_manual:
        # Spec imperative: never persist a low-confidence guess.
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "error": "CONFIDENCE_GATE_REJECTED",
                "confidence": entry.confidence_score,
                "floor": CONFIDENCE_FLOOR,
                "message": "Confidence below the 0.75 checkpoint and not flagged manual — route to the manual correction interface.",
            },
        )
    class_registry = CLASSES.get(subject, {})
    if entry.class_id not in class_registry:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail={"error": "UNKNOWN_CLASS", "classId": entry.class_id})
    roster = STUDENTS.get(subject, {}).get(entry.class_id, {})
    if entry.student_id not in roster:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail={"error": "UNKNOWN_STUDENT", "studentId": entry.student_id})
    user_ledger = LEDGER.setdefault(subject, {})
    if entry.id in user_ledger:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail={"error": "DUPLICATE_ENTRY_ID", "entryId": entry.id})
    if len(user_ledger) >= MAX_LEDGER_ENTRIES_PER_USER:
        raise HTTPException(status_code=status.HTTP_507_INSUFFICIENT_STORAGE,
                            detail="Ledger capacity reached for this account.")


def _build_version(subject: str, entry_id: str, version: int, score: str,
                   original: Dict[str, Any], reason: str) -> Dict[str, Any]:
    v = {
        "version": version,
        "score": score,
        "detected_name": original.get("detected_name"),
        "student_id": original.get("student_id"),
        "confidence_score": original.get("confidence_score"),
        "is_flagged_manual": original.get("is_flagged_manual"),
        "modified_by": subject,
        "timestamp": time.time(),
        "change_reason": reason,
    }
    v["signature"] = sign_version(subject, entry_id, v)
    return v


# ---------------------------------------------------------------------------
# FastAPI application
# ---------------------------------------------------------------------------

app = FastAPI(
    title="AI Mark Entry System — Secure Core API Backend",
    version=APP_VERSION,
    description=(
        "Production API layer: token handshakes, transactional batch ingest, "
        "server-side confidence gating, and an append-only signed audit ledger."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Load shedding: body-size cap + per-IP sliding-window rate limit ---------

_rate_buckets: Dict[str, deque] = defaultdict(deque)


@app.middleware("http")
async def abuse_guard(request: Request, call_next):
    """Rejects oversized bodies before they hit a worker and rate-limits per
    client IP, so one slow OCR consumer (or an attacker) cannot starve the
    service for everyone on launch day."""
    content_length = request.headers.get("content-length", "")
    if content_length.isdigit() and int(content_length) > MAX_BODY_BYTES:
        return JSONResponse(status_code=413, content={"detail": {"error": "PAYLOAD_TOO_LARGE"}})
    ip = request.client.host if request.client else "?"
    now = time.time()
    bucket = _rate_buckets[ip]
    while bucket and bucket[0] <= now - RATE_LIMIT_WINDOW_S:
        bucket.popleft()
    if len(bucket) >= RATE_LIMIT_REQUESTS:
        return JSONResponse(status_code=429, content={"detail": {"error": "RATE_LIMITED"}})
    bucket.append(now)
    return await call_next(request)


@app.get("/health", tags=["System"])
async def health() -> Dict[str, str]:
    return {"status": "ok", "version": APP_VERSION}


@app.get("/version", tags=["System"])
async def version() -> Dict[str, Any]:
    """Build + capability probe for the app's Settings > Test-connection flow.
    Reports only non-sensitive facts — never configuration values or secrets."""
    return {
        "service": "ai-mark-entry-vision",
        "version": APP_VERSION,
        "ocr_available": _ocr_ready(),
    }


# --- Vision (real computer vision mode) --------------------------------------


class VisionAnalyzePayload(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    image_b64: str = Field(..., alias="imageB64", min_length=32, max_length=12_000_000)
    confidence_floor: Optional[float] = Field(None, alias="confidenceFloor", ge=0.0, le=1.0)


def _ocr_ready() -> bool:
    """True only when both the pytesseract package and the Tesseract binary exist."""
    try:
        import pytesseract

        pytesseract.get_tesseract_version()
        return True
    except Exception:
        return False


@app.get("/vision/health", tags=["Vision"])
async def vision_health() -> Dict[str, Any]:
    """Reachability probe for the app's CV mode — reports OCR availability, no data."""
    return {"ok": True, "ocr": _ocr_ready()}


# Bounded vision concurrency: slots released by timeout or completion.
_vision_sem = asyncio.Semaphore(MAX_CONCURRENT_VISION)


@app.post("/vision/analyze", tags=["Vision"])
async def analyze_paper(payload: VisionAnalyzePayload, subject: str = Depends(current_teacher)) -> Dict[str, Any]:
    """Real computer vision mode: OpenCV quality check → Tesseract OCR →
    regex extraction → confidence gate, returned as the strict frame contract:
    paper_detected, read_quality (clear | blurry | underexposed), latency
    estimate, extracted student identifiers and the raw mark count. A gated
    read comes back with null identifiers / zero marks / low confidence — the
    engine never turns a low-confidence guess into a savable result, and the
    caller must route it to manual correction."""
    try:
        import cv2
        import numpy as np
        from vision_engine import AdvancedVisionInferenceEngine
    except ImportError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail={"error": "VISION_STACK_UNAVAILABLE", "detail": str(exc)})
    try:
        image_bytes = base64.b64decode(payload.image_b64, validate=True)
    except (ValueError, TypeError):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail={"error": "FRAME_UNREADABLE"})
    image = cv2.imdecode(np.frombuffer(image_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail={"error": "FRAME_UNREADABLE"})
    engine = AdvancedVisionInferenceEngine(
        confidence_floor=payload.confidence_floor if payload.confidence_floor is not None else CONFIDENCE_FLOOR,
    )
    # Concurrency cap + hard timeout: OCR is CPU-bound, so a hung or huge
    # frame must never hold a worker forever — it times out and frees the slot.
    try:
        async with _vision_sem:
            result = await asyncio.wait_for(
                asyncio.to_thread(engine.process_image_array, image),
                timeout=VISION_TIMEOUT_SECONDS,
            )
    except asyncio.TimeoutError:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail={"error": "VISION_TIMEOUT"})
    if result.get("status") == "ERROR":
        # Honest failure: e.g. OCR_BACKEND_UNAVAILABLE when Tesseract is missing.
        code = (result.get("error_code") or "VISION_ENGINE_FAILED").split(":")[0]
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail={"error": code})
    p = result.get("payload") or {}
    identity = p.get("identity") or p.get("extracted_identity")
    if identity == "UNREADABLE":
        identity = None
    name = p.get("full_name") or p.get("extracted_full_name") or None
    # Strict frame contract — exactly these keys, minified single-line JSON.
    return {
        "paper_detected": bool(p.get("paper_detected", False)),
        "metadata": {
            "read_quality": p.get("read_quality") or "blurry",
            "inference_latency_ms_estimate": int(p.get("latency_ms") or 0),
            # Normalized (0..1) bounds of the detected paper region, null when
            # no paper — the app draws its live bounding box from this.
            "paper_bounds": p.get("paper_bounds"),
        },
        "student_identifiers": {
            "extracted_id": identity,
            "extracted_name": name,
        },
        "grading_metrics": {
            "detected_marks_count": int(p.get("detected_marks_count") or 0),
            "confidence_score": round(float(result.get("confidence") or 0.0), 4),
        },
    }


# --- Authentication ---------------------------------------------------------


@app.post("/auth/login", response_model=TokenResponse, tags=["Authentication"])
async def handle_login(payload: LoginPayload) -> Dict[str, Any]:
    record = USERS.get(payload.email)
    if record is None or not verify_password(payload.password, record["password_hash"]):
        # Identical error for unknown user and wrong password (no account enumeration).
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Invalid authentication credentials.")
    return {
        "access_token": mint_token(payload.email, "access", ACCESS_TTL_SECONDS),
        "refresh_token": mint_token(payload.email, "refresh", REFRESH_TTL_SECONDS),
        "token_type": "bearer",
        "expires_in": ACCESS_TTL_SECONDS,
    }


@app.post("/auth/refresh", response_model=TokenResponse, tags=["Authentication"])
async def handle_refresh(payload: RefreshPayload) -> Dict[str, Any]:
    subject = verify_token(payload.refresh_token, "refresh")
    return {
        "access_token": mint_token(subject, "access", ACCESS_TTL_SECONDS),
        "refresh_token": mint_token(subject, "refresh", REFRESH_TTL_SECONDS),
        "token_type": "bearer",
        "expires_in": ACCESS_TTL_SECONDS,
    }


# --- Academic core ----------------------------------------------------------


@app.post("/classes", status_code=status.HTTP_201_CREATED, tags=["Academic Core"])
async def register_class(payload: ClassSetupPayload, subject: str = Depends(current_teacher)) -> Dict[str, Any]:
    user_classes = CLASSES.setdefault(subject, {})
    if payload.class_id in user_classes:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail=f"Class '{payload.class_id}' already exists for this teacher.")
    user_classes[payload.class_id] = {
        "name": payload.name,
        "created_by": subject,
        "created_at": time.time(),
        "roster_size": len(payload.students),
    }
    roster = {s.student_id: s.model_dump(by_alias=True) for s in payload.students}
    STUDENTS.setdefault(subject, {})[payload.class_id] = roster
    _persist()
    return {"status": "SUCCESS", "classId": payload.class_id, "rosterSize": len(payload.students)}


@app.get("/classes", tags=["Academic Core"])
async def list_classes(subject: str = Depends(current_teacher)) -> List[Dict[str, Any]]:
    return [
        {"classId": class_id, **meta}
        for class_id, meta in CLASSES.get(subject, {}).items()
    ]


@app.get("/classes/{class_id}/students", response_model=List[StudentRosterItem], tags=["Academic Core"])
async def fetch_student_roster(class_id: str, subject: str = Depends(current_teacher)) -> List[StudentRosterItem]:
    roster = STUDENTS.get(subject, {}).get(class_id)
    if roster is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail="Requested class reference identifier not found.")
    return [StudentRosterItem.model_validate(item) for item in roster.values()]


# --- Ingestion grid ---------------------------------------------------------


@app.post("/entries", status_code=status.HTTP_201_CREATED, tags=["Ingestion Grid"])
async def submit_confirmed_mark(payload: MarkEntryInbound, subject: str = Depends(current_teacher)) -> Dict[str, Any]:
    _validate_entry(subject, payload)
    original = {
        "detected_name": payload.detected_name,
        "student_id": payload.student_id,
        "confidence_score": payload.confidence_score,
        "is_flagged_manual": payload.is_flagged_manual,
    }
    version = _build_version(subject, payload.id, 1, payload.score, original,
                             "Initial automated capture verification checkpoint ingestion.")
    LEDGER.setdefault(subject, {})[payload.id] = [version]
    _persist()
    return {"status": "PERSISTED", "assigned_id": payload.id, "current_version": 1}


@app.post("/entries/batch", status_code=status.HTTP_201_CREATED, tags=["Ingestion Grid"])
async def submit_batch(payload: MarkEntryBatchPayload, subject: str = Depends(current_teacher)) -> Dict[str, Any]:
    """Transactional batch ingest: every row is validated first; if any row
    fails, the entire batch is rejected with per-item errors and nothing is
    written (all-or-nothing semantics)."""
    errors: List[Dict[str, Any]] = []
    for index, entry in enumerate(payload.entries):
        try:
            _validate_entry(subject, entry)
        except HTTPException as exc:
            errors.append({"index": index, "entryId": entry.id, "detail": exc.detail})
    if errors:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail={"error": "BATCH_REJECTED", "items": errors})
    persisted: List[Dict[str, Any]] = []
    for entry in payload.entries:
        original = {
            "detected_name": entry.detected_name,
            "student_id": entry.student_id,
            "confidence_score": entry.confidence_score,
            "is_flagged_manual": entry.is_flagged_manual,
        }
        version = _build_version(subject, entry.id, 1, entry.score, original,
                                 "Initial automated capture verification checkpoint ingestion.")
        LEDGER.setdefault(subject, {})[entry.id] = [version]
        persisted.append({"assigned_id": entry.id, "current_version": 1})
    _persist()
    return {"status": "PERSISTED", "count": len(persisted), "entries": persisted}


@app.patch("/entries/{entry_id}", tags=["Ingestion Grid"])
async def override_locked_entry(entry_id: str, payload: CorrectionPayload,
                                subject: str = Depends(current_teacher)) -> Dict[str, Any]:
    """Append-only correction: appends a signed version increment.

    The original AI-capture fields (version 1) are carried forward unchanged —
    corrections never rewrite detection metadata, and no route in this module
    can delete or overwrite a historical version.
    """
    chain = LEDGER.get(subject, {}).get(entry_id)
    if not chain:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail="Target record ledger historical node missing.")
    original = chain[0]
    new_version = _build_version(subject, entry_id, original["version"] + len(chain), payload.score,
                                 {"detected_name": original["detected_name"],
                                  "student_id": original["student_id"],
                                  "confidence_score": original["confidence_score"],
                                  "is_flagged_manual": original["is_flagged_manual"]},
                                 payload.reason)
    chain.append(new_version)
    _persist()
    return {"status": "IMMUTABLE_DELTA_APPENDED", "current_version": new_version["version"]}


@app.get("/entries", tags=["Ingestion Grid"])
async def list_entries(subject: str = Depends(current_teacher)) -> List[Dict[str, Any]]:
    """Latest-state summary for every ledger entry owned by this teacher."""
    summary: List[Dict[str, Any]] = []
    for entry_id, chain in LEDGER.get(subject, {}).items():
        latest = chain[-1]
        summary.append({"entryId": entry_id, "currentVersion": latest["version"],
                        "score": latest["score"], "studentId": latest["student_id"],
                        "updatedAt": latest["timestamp"], "revisions": len(chain)})
    return summary


@app.get("/entries/{entry_id}", tags=["Ingestion Grid"])
async def latest_entry_state(entry_id: str, subject: str = Depends(current_teacher)) -> Dict[str, Any]:
    chain = LEDGER.get(subject, {}).get(entry_id)
    if not chain:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Record not found in ledger.")
    return {"entryId": entry_id, "latest": chain[-1], "revisions": len(chain)}


@app.get("/entries/{entry_id}/history", tags=["Ingestion Grid"])
async def view_record_audit_trail(entry_id: str, subject: str = Depends(current_teacher)) -> List[Dict[str, Any]]:
    chain = LEDGER.get(subject, {}).get(entry_id)
    if not chain:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail="Target record ledger historical node missing.")
    return chain


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=int(os.environ.get("PORT", "8000")), reload=False)
