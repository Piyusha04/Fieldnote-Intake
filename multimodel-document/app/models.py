from datetime import datetime, timezone

from sqlalchemy import DateTime, Float, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    document_type: Mapped[str] = mapped_column(String(100), default="Document")
    status: Mapped[str] = mapped_column(String(32), default="needs_review", index=True)
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    page_count: Mapped[int] = mapped_column(Integer, default=0)
    fields: Mapped[list] = mapped_column(JSON, default=list)
    tables: Mapped[list] = mapped_column(JSON, default=list)
    pages: Mapped[list] = mapped_column(JSON, default=list)
    storage_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    extraction_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), index=True
    )
