"""ORM model for writing drafts (全文写作草稿)."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import JSON, Boolean, DateTime, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from deerflow.persistence.base import Base


class WritingDraftRow(Base):
    __tablename__ = "writing_drafts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)

    # 写作元数据
    project_name: Mapped[str] = mapped_column(String(256), default="")
    doc_type: Mapped[str] = mapped_column(String(64), default="report")
    mode: Mapped[str | None] = mapped_column(String(32), nullable=True)  # "from-scratch" | "upload-template"
    stage: Mapped[str] = mapped_column(String(32), default="start")  # "start" | "writing" | "complete"

    # 上传的文件信息 [{name, path, type}]
    files: Mapped[dict] = mapped_column(JSON, default=list)

    # 章节内容 [{id, title, content, structure?, bodyText?}]
    # 核心数据：保存 stage1 解析的章节结构和 stage2 生成的正文
    chapters: Mapped[dict] = mapped_column(JSON, default=list)

    # 字数范围
    word_count_min: Mapped[int] = mapped_column(Integer, default=0)
    word_count_max: Mapped[int] = mapped_column(Integer, default=0)

    # 修改需求输入
    demand_input: Mapped[str] = mapped_column(Text, default="")

    # 完成标记
    finished: Mapped[bool] = mapped_column(Boolean, default=False)

    # 写作时使用的模型名称（前端选择）
    model_name: Mapped[str | None] = mapped_column(String(128), nullable=True, default=None)

    # 关联的知识库集合 ID（前端选择）
    kb_collection_id: Mapped[str | None] = mapped_column(String(64), nullable=True, default=None)

    # 生成进度状态机
    # { status: "idle"|"generating"|"completed"|"interrupted",
    #   pending_chapters: [index, ...],
    #   failed_chapters: [index, ...],
    #   generated_chapters: [index, ...],
    #   last_error: "" }
    generation_state: Mapped[dict] = mapped_column(JSON, default=dict)

    # 乐观并发控制版本号：每次 update 递增，用于检测并发写入冲突
    version: Mapped[int] = mapped_column(Integer, default=1)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    __table_args__ = (
        Index("ix_writing_drafts_user_updated", "user_id", "updated_at"),
    )
