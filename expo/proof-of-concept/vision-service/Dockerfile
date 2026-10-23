FROM python:3.11-slim

# Tesseract engine for the OCR stage of the vision pipeline
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py vision_engine.py ./

# Rotate this in production: docker run -e MARKBOOK_SERVER_SECRET=...
ENV PORT=8000
EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
