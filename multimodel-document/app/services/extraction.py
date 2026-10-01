import base64
import json
import os
import re
from io import BytesIO

import httpx
import pytesseract
import pymupdf as fitz
from PIL import Image
from pypdf import PdfReader


FIELD_DEFINITIONS = [
    ("insured_name", "Insured name"),
    ("policy_number", "Policy number"),
    ("claim_number", "Claim number"),
    ("effective_date", "Effective date"),
    ("loss_date", "Date of loss"),
    ("claim_amount", "Claim amount"),
]


def _table_rows(text: str, page_number: int) -> list[dict]:
    rows = []
    for line in text.splitlines():
        cells = [cell.strip() for cell in re.split(r"\s{2,}|\s*\|\s*", line.strip()) if cell.strip()]
        if len(cells) >= 2:
            rows.append(cells)
    if len(rows) < 2:
        return []
    return [{"page": page_number, "headers": rows[0], "rows": rows[1:]}]


def _source_for(value: str, pages: list[str]) -> dict:
    if value:
        for page_number, page_text in enumerate(pages, start=1):
            match = re.search(re.escape(value), page_text, flags=re.IGNORECASE)
            if match:
                start = max(0, match.start() - 70)
                end = min(len(page_text), match.end() + 90)
                return {"page": page_number, "excerpt": " ".join(page_text[start:end].split())}
    return {"page": 1, "excerpt": "No matching text found; verify against the page image."}


def _fallback_fields(pages: list[str]) -> list[dict]:
    text = "\n".join(pages)
    patterns = {
        "insured_name": r"(?:insured|patient|account holder)(?:\s+name)?\s*[:#-]\s*([^\n|]+)",
        "policy_number": r"(?:policy\s*(?:number|no\.?|#))\s*[:#-]?\s*([A-Z0-9-]+)",
        "claim_number": r"(?:claim\s*(?:number|no\.?|#))\s*[:#-]?\s*([A-Z0-9-]+)",
        "effective_date": r"(?:effective\s*date|policy\s*period\s*start)\s*[:#-]?\s*([^\n|]+)",
        "loss_date": r"(?:date\s+of\s+loss|loss\s+date|date\s+of\s+service)\s*[:#-]?\s*([^\n|]+)",
        "claim_amount": r"(?:claim\s*amount|amount\s*(?:claimed|due)|total\s*billed)\s*[:#-]?\s*([$€£]?\s?[\d,]+(?:\.\d{2})?)",
    }
    fields = []
    for key, label in FIELD_DEFINITIONS:
        match = re.search(patterns[key], text, flags=re.IGNORECASE)
        value = match.group(1).strip() if match else ""
        fields.append({"key": key, "label": label, "value": value,
                       "confidence": 0.58 if value else 0.12, "source": _source_for(value, pages)})
    return fields


def _render_page_images(pdf_content: bytes, limit: int = 4) -> list[str]:
    document = fitz.open(stream=pdf_content, filetype="pdf")
    images = []
    for page in document[:limit]:
        pixmap = page.get_pixmap(matrix=fitz.Matrix(1.3, 1.3), alpha=False)
        images.append(base64.b64encode(pixmap.tobytes("jpeg")).decode("ascii"))
    return images


async def _extract_with_model(pdf_content: bytes, pages: list[str]) -> dict | None:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return None
    base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
    model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
    content = [{"type": "text", "text": (
        "Extract insurance, healthcare, or banking fields from this document. Return JSON only with "
        "document_type, fields (array of {key,label,value,confidence,page,excerpt}), and tables "
        "(array of {page,headers,rows}). Preserve table cell text and never infer missing values. "
        "Allowed field keys: insured_name, policy_number, claim_number, effective_date, loss_date, claim_amount. "
        "OCR text by page: " + json.dumps(pages, ensure_ascii=False)
    )}]
    content.extend({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image}"}}
                   for image in _render_page_images(pdf_content))
    async with httpx.AsyncClient(timeout=90) as client:
        response = await client.post(
            f"{base_url}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}"},
            json={"model": model, "temperature": 0, "response_format": {"type": "json_object"},
                  "messages": [{"role": "user", "content": content}]},
        )
        response.raise_for_status()
    result = json.loads(response.json()["choices"][0]["message"]["content"])
    fields = []
    for field in result.get("fields", []):
        source = field.get("source") or {
            "page": int(field.get("page") or 1),
            "excerpt": field.get("excerpt") or _source_for(str(field.get("value", "")), pages)["excerpt"],
        }
        fields.append({
            "key": field.get("key", "other"),
            "label": field.get("label", field.get("key", "Field").replace("_", " ").title()),
            "value": str(field.get("value") or ""),
            "confidence": max(0.0, min(1.0, float(field.get("confidence", 0.5)))),
            "source": {"page": max(1, int(source.get("page", 1))), "excerpt": str(source.get("excerpt", ""))},
        })
    return {"document_type": result.get("document_type", "Document"), "fields": fields or _fallback_fields(pages),
            "tables": result.get("tables", []), "note": f"Multimodal extraction via {model}"}


async def extract_document(pdf_content: bytes) -> dict:
    reader = PdfReader(BytesIO(pdf_content))
    pages = [(page.extract_text() or "").strip() for page in reader.pages]
    ocr_used = False
    if sum(len(page) for page in pages) < 40:
        try:
            if os.getenv("TESSERACT_CMD"):
                pytesseract.pytesseract.tesseract_cmd = os.environ["TESSERACT_CMD"]
            rendered = fitz.open(stream=pdf_content, filetype="pdf")
            for index, page in enumerate(rendered):
                pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
                pages[index] = pytesseract.image_to_string(Image.open(BytesIO(pixmap.tobytes("png")))).strip()
            ocr_used = True
        except (pytesseract.TesseractNotFoundError, OSError):
            pass

    model_error = None
    try:
        model_result = await _extract_with_model(pdf_content, pages)
    except (httpx.HTTPError, json.JSONDecodeError, KeyError, TypeError, ValueError, AttributeError) as exc:
        model_result = None
        model_error = type(exc).__name__
    if model_result:
        result = model_result
    else:
        result = {
            "document_type": "Claim document" if re.search(r"claim|loss", "\n".join(pages), re.I) else "Policy document",
            "fields": _fallback_fields(pages),
            "tables": [table for page_number, text in enumerate(pages, start=1) for table in _table_rows(text, page_number)],
            "note": "Local text extraction. Configure OPENAI_API_KEY for vision-assisted extraction." +
                    (" OCR was applied to scanned pages." if ocr_used else " Scanned pages need Tesseract or a vision model.") +
                    (f" Vision extraction unavailable ({model_error}); local fallback used." if model_error else ""),
        }
    confidence = sum(field["confidence"] for field in result["fields"]) / max(1, len(result["fields"]))
    return {**result, "pages": pages, "page_count": len(pages), "confidence": round(confidence, 3),
            "status": "needs_review" if confidence < 0.82 else "approved"}
