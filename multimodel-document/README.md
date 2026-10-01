# Fieldnote Intake

A FastAPI document-intake workflow for insurance, healthcare, and banking PDFs. It extracts fields with page-level source references, preserves table cells in structured rows, and routes uncertain results into a review desk.

## Run locally

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
uvicorn app.main:app --reload
```

Open http://127.0.0.1:8000. The queue starts empty; add a PDF to begin processing. Existing uploads are retained across restarts and can be removed from each document's actions menu.

## Extraction

- Text PDFs are read with pypdf. Image-only pages use Tesseract OCR if its executable is installed and available on `PATH` or configured with `TESSERACT_CMD`.
- Set `OPENAI_API_KEY`, `OPENAI_BASE_URL`, and `OPENAI_MODEL` to enable OpenAI-compatible multimodal extraction. Up to four pages are rendered as images and sent alongside extracted text. Without credentials, local text extraction is used.
- Each extracted field includes a confidence, source page, and source excerpt. Tables are stored as headers and rows. Average field confidence below 82% routes a document to review.

## Storage and database

Defaults are SQLite at `./intake.db` and uploaded PDFs in `./uploads`. Set `DATABASE_URL` to a PostgreSQL SQLAlchemy URL, for example `postgresql+psycopg://user:password@localhost:5432/fieldnote`. Set `S3_BUCKET` and optionally `AWS_REGION` / `AWS_ENDPOINT_URL` to store originals in an S3-compatible bucket. Credentials use the standard AWS SDK credential chain.

## API

- `GET /api/health` reports service, model, OCR, database, and storage configuration.
- `GET /api/documents` lists the queue; `GET /api/documents/{id}` returns a document.
- `POST /api/documents` accepts multipart `file` PDFs up to 25 MB.
- `PATCH /api/documents/{id}` saves `{ "fields": { "claim_number": "..." }, "status": "approved" }`.
- `DELETE /api/documents/{id}` removes a document and its stored PDF.
- `GET /docs` exposes the OpenAPI schema.

Add authentication, encryption/key management, retention controls, malware scanning, and tenant isolation before exposing this prototype to regulated or production data.
