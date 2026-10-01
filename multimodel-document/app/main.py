import os
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
import shutil

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import Base, SessionLocal, engine
from app.models import Document
from app.schemas import DocumentOut, ReviewUpdate
from app.services.extraction import extract_document
from app.services.storage import delete_document_file, store_document

STATIC_DIR = Path(__file__).parent / "static"


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(title="Fieldnote Intake", version="1.0.0", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


def get_session():
    with SessionLocal() as session:
        yield session


@app.get("/", include_in_schema=False)
def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "model_configured": bool(os.getenv("OPENAI_API_KEY")),
        "ocr_configured": bool(os.getenv("TESSERACT_CMD") or shutil.which("tesseract")),
        "storage": "s3" if os.getenv("S3_BUCKET") else "local",
        "database": engine.dialect.name,
        "review_threshold": 0.82,
        "max_upload_bytes": 25 * 1024 * 1024,
    }


@app.get("/api/documents", response_model=list[DocumentOut])
def list_documents(session: Session = Depends(get_session)):
    return session.scalars(select(Document).order_by(Document.created_at.desc())).all()


@app.get("/api/documents/{document_id}", response_model=DocumentOut)
def get_document(document_id: str, session: Session = Depends(get_session)):
    document = session.get(Document, document_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    return document


@app.post("/api/documents", response_model=DocumentOut, status_code=201)
async def upload_document(file: UploadFile = File(...), session: Session = Depends(get_session)):
    if not file.filename or Path(file.filename).suffix.lower() != ".pdf":
        raise HTTPException(status_code=415, detail="Upload a PDF document")
    content = await file.read(25 * 1024 * 1024 + 1)
    if len(content) > 25 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="PDF must be 25 MB or smaller")
    if not content.startswith(b"%PDF"):
        raise HTTPException(status_code=415, detail="The uploaded file is not a valid PDF")
    try:
        extraction = await extract_document(content)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Could not extract this PDF: {exc}") from exc
    document_id = str(uuid.uuid4())
    try:
        storage_key = store_document(document_id, file.filename, content)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Could not store document: {exc}") from exc
    document = Document(
        id=document_id, filename=Path(file.filename).name, document_type=extraction["document_type"],
        status=extraction["status"], confidence=extraction["confidence"], page_count=extraction["page_count"],
        fields=extraction["fields"], tables=extraction["tables"], pages=extraction["pages"],
        storage_key=storage_key, extraction_note=extraction["note"],
    )
    session.add(document)
    session.commit()
    session.refresh(document)
    return document


@app.patch("/api/documents/{document_id}", response_model=DocumentOut)
def update_review(document_id: str, update: ReviewUpdate, session: Session = Depends(get_session)):
    document = session.get(Document, document_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    document.fields = [{**field, "value": update.fields.get(field["key"], field["value"])}
                       for field in document.fields]
    document.status = update.status
    session.commit()
    session.refresh(document)
    return document


@app.delete("/api/documents/{document_id}", status_code=204)
def delete_document(document_id: str, session: Session = Depends(get_session)):
    document = session.get(Document, document_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    try:
        delete_document_file(document.storage_key)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Could not remove stored document: {exc}") from exc
    session.delete(document)
    session.commit()
