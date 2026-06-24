"""SQLAlchemy ORM models for Knowledge Base.

Tables:
- kb_collections: Knowledge base collections (groupings of documents).
- kb_documents: Document metadata with flexible JSONB custom_fields.
- kb_tree_indices: PageIndex tree index stored as JSONB.
- kb_chunks: Cached node text content for fast retrieval.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import (
    DateTime,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from deerflow.persistence.base import Base


class KBCollectionRow(Base):
    """Knowledge base collection (a group/category of documents)."""

    __tablename__ = "kb_collections"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )
    user_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, default="")
    # Optional custom metadata schema for routing
    metadata_schema: Mapped[dict | None] = mapped_column(JSONB, default=dict)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    __table_args__ = (
        Index("ix_kb_collections_user", "user_id"),
        {"extend_existing": True},
    )


class KBDocumentRow(Base):
    """Document metadata stored in a knowledge base collection."""

    __tablename__ = "kb_documents"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )
    collection_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        nullable=False,
        index=True,
    )
    user_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)

    # Core metadata
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    doc_type: Mapped[str | None] = mapped_column(String(50), default="md")
    doc_format: Mapped[str | None] = mapped_column(String(50), default="markdown")

    # Flexible custom fields (JSONB) — NOT named "metadata" to avoid SQLAlchemy conflict
    custom_fields: Mapped[dict | None] = mapped_column("meta_data", JSONB, default=dict)

    # File info
    file_path: Mapped[str | None] = mapped_column(String(1000))
    file_size: Mapped[int | None] = mapped_column(Integer, default=0)
    original_filename: Mapped[str | None] = mapped_column(String(500))

    # Doc stats
    page_count: Mapped[int | None] = mapped_column(Integer, default=0)
    line_count: Mapped[int | None] = mapped_column(Integer, default=0)
    token_count: Mapped[int | None] = mapped_column(Integer, default=0)

    # Processing status: pending / indexing / ready / failed
    status: Mapped[str] = mapped_column(String(20), default="pending")
    error_message: Mapped[str | None] = mapped_column(Text, default="")

    # Doc description from PageIndex
    doc_description: Mapped[str | None] = mapped_column(Text, default="")

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    __table_args__ = (
        Index("ix_kb_documents_collection", "collection_id"),
        Index("ix_kb_documents_user", "user_id"),
        Index("ix_kb_documents_status", "status"),
        {"extend_existing": True},
    )


class KBTreeIndexRow(Base):
    """PageIndex tree index stored as JSONB."""

    __tablename__ = "kb_tree_indices"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )
    doc_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        nullable=False,
        unique=True,
        index=True,
    )
    tree_json: Mapped[dict | None] = mapped_column(JSONB, nullable=False)
    depth: Mapped[int | None] = mapped_column(Integer, default=0)
    node_count: Mapped[int | None] = mapped_column(Integer, default=0)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    __table_args__ = (
        Index("ix_kb_tree_indices_doc", "doc_id"),
        {"extend_existing": True},
    )


class KBChunkRow(Base):
    """Cached node text content for fast retrieval."""

    __tablename__ = "kb_chunks"

    id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )
    doc_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False),
        nullable=False,
        index=True,
    )
    node_id: Mapped[str] = mapped_column(String(20), nullable=False)
    title: Mapped[str | None] = mapped_column(String(500), default="")
    page_range: Mapped[str | None] = mapped_column(String(50), default="")
    content: Mapped[str | None] = mapped_column(Text, default="")
    token_count: Mapped[int | None] = mapped_column(Integer, default=0)
    summary: Mapped[str | None] = mapped_column(Text, default="")

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC),
    )

    __table_args__ = (
        Index("ix_kb_chunks_doc_node", "doc_id", "node_id"),
        {"extend_existing": True},
    )
