from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class SourceReference(BaseModel):
    page: int = Field(ge=1)
    excerpt: str = ""


class ExtractedField(BaseModel):
    key: str
    label: str
    value: str = ""
    confidence: float = Field(ge=0, le=1)
    source: SourceReference


class DocumentOut(BaseModel):
    id: str
    filename: str
    document_type: str
    status: Literal["needs_review", "approved"]
    confidence: float
    page_count: int
    fields: list[ExtractedField]
    tables: list[dict]
    pages: list[str]
    extraction_note: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class ReviewUpdate(BaseModel):
    fields: dict[str, str]
    status: Literal["needs_review", "approved"] = "approved"
