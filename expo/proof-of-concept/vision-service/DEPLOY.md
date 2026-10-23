# Deploying the vision-service (real CV / OCR mode)

The `vision-service` in this project is the real computer-vision backend:
OpenCV preprocessing → Tesseract OCR → regex extraction → confidence gate
(never returns a savable low-confidence guess). The MarkBook app talks to it
over HTTPS from **Settings → CV service address / Vision service account**.

It cannot run inside Expo Go or this sandbox — it needs a machine with
Tesseract. Deploy it once on any host you control; then the CV engine in the
app works end-to-end (scan → analyze → gated result → save/manual fallback).

## 1. Run it anywhere (Docker — recommended)

```bash
cd vision-service
docker build -t markbook-vision .
docker run -d --name markbook-vision \
  -p 8000:8000 \
  -e MARKBOOK_SERVER_SECRET="$(openssl rand -hex 32)" \
  -e MARKBOOK_DEMO_EMAIL=teacher@yourschool.edu \
  -e MARKBOOK_DEMO_PASSWORD='a-long-password-you-keep-secret' \
  markbook-vision
```

The container installs Tesseract automatically (see `Dockerfile`), so
`/vision/health` will report `"ocr": true`.

### Environment variables

| Variable                  | Purpose                                                        |
| ------------------------- | -------------------------------------------------------------- |
| `MARKBOOK_SERVER_SECRET`  | HMAC secret for token signing + record signatures. **REQUIRED in production** — without it the secret is random per boot and all sessions invalidate on restart. |
| `MARKBOOK_DEMO_EMAIL`     | Teacher account seeded at boot (default `teacher@academy.edu`). |
| `MARKBOOK_DEMO_PASSWORD`  | Password for the seeded account (default `change-me-immediately` — change it). |
| `MARKBOOK_CORS_ORIGINS`   | Comma-separated allowed origins (default `*`).                  |

> The service signs its own access (8 h) / refresh (30 days) tokens. The app
> signs in once with the seeded account and refreshes silently — the password
> is never stored on the phone.

Load-shedding environment variables (all optional):

| Variable | Default | Purpose |
|---|---|---|
| `MARKBOOK_RATE_LIMIT_REQUESTS` | `120` | Requests per client IP per window before HTTP 429 |
| `MARKBOOK_RATE_LIMIT_WINDOW_S` | `60` | Sliding-window length in seconds |
| `MARKBOOK_MAX_BODY_BYTES` | `10485760` | Rejects larger request bodies with HTTP 413 |
| `MARKBOOK_VISION_TIMEOUT_S` | `30` | Hard per-frame OCR timeout (HTTP 503 `VISION_TIMEOUT`) |
| `MARKBOOK_VISION_MAX_CONCURRENCY` | `2` | Max simultaneous OCR analyses; excess requests queue |

## 2. Put it on a public HTTPS URL

The phone must be able to reach it. Any of these works:

- **Fly.io**: `fly launch --no-deploy && fly deploy && fly certs add vision.yourschool.edu`
- **Render / Railway**: create a service from the `vision-service` folder; set the env vars above.
- **School server**: run the container behind nginx/Caddy with TLS (e.g. `vision.school.edu` → `localhost:8000`).

## 3. Connect the app

1. MarkBook → **Settings → CV service address** → `https://vision.yourschool.edu`
2. **Vision service account** → sign in with the seeded email/password.
3. **Test connection** → should show *Online — OCR ready*.
4. Set **Vision engine → CV (OCR)**. Scan a paper: OpenCV + Tesseract run for
   real; reads below the 0.75 confidence floor are gated to manual entry.

## 4. Verify the pipeline without the app

```bash
curl https://vision.yourschool.edu/vision/health   # {"ok":true,"ocr":true}
```

Authenticated analyze (tokens from `/auth/login`) accepts
`{"imageB64": "<base64 jpeg>"}` and returns the gate response
(`EXECUTE_CONFIRMATION_PROMPT` / `MANUAL_FALLBACK_REQUIRED`) with exactly three
paper reads — `identity` (student ID), `fullName`, `score` (marks) — plus
confidence. No generic object detection exists in this service.
