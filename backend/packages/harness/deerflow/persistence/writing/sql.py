"""SQLAlchemy-backed writing draft repository."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from deerflow.persistence.writing.base import WritingStore
from deerflow.persistence.writing.model import WritingDraftRow
from deerflow.runtime.user_context import AUTO, _AutoSentinel, resolve_user_id


class WritingRepository(WritingStore):
    def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
        self._sf = session_factory

    @staticmethod
    def _row_to_dict(row: WritingDraftRow) -> dict[str, Any]:
        d = row.to_dict()
        for key in ("created_at", "updated_at"):
            val = d.get(key)
            if isinstance(val, datetime):
                d[key] = val.isoformat()
        return d

    async def create(
        self,
        *,
        project_name: str = "",
        doc_type: str = "report",
        mode: str | None = None,
        user_id: str | None | _AutoSentinel = AUTO,
    ) -> dict:
        resolved_user_id = resolve_user_id(user_id, method_name="WritingRepository.create")
        now = datetime.now(UTC)
        row = WritingDraftRow(
            user_id=resolved_user_id,
            project_name=project_name,
            doc_type=doc_type,
            mode=mode,
            stage="start",
            files=[],
            chapters=[],
            generation_state={"status": "idle", "pending_chapters": [], "failed_chapters": [], "generated_chapters": []},
            created_at=now,
            updated_at=now,
        )
        async with self._sf() as session:
            session.add(row)
            await session.commit()
            await session.refresh(row)
            return self._row_to_dict(row)

    async def get(
        self,
        draft_id: int,
        *,
        user_id: str | None | _AutoSentinel = AUTO,
    ) -> dict | None:
        resolved_user_id = resolve_user_id(user_id, method_name="WritingRepository.get")
        async with self._sf() as session:
            row = await session.get(WritingDraftRow, draft_id)
            if row is None:
                return None
            if resolved_user_id is not None and row.user_id != resolved_user_id:
                return None
            return self._row_to_dict(row)

    async def list_drafts(
        self,
        *,
        limit: int = 50,
        offset: int = 0,
        user_id: str | None | _AutoSentinel = AUTO,
    ) -> list[dict]:
        resolved_user_id = resolve_user_id(user_id, method_name="WritingRepository.list_drafts")
        stmt = (
            select(WritingDraftRow)
            .order_by(WritingDraftRow.updated_at.desc())
            .limit(limit)
            .offset(offset)
        )
        if resolved_user_id is not None:
            stmt = stmt.where(WritingDraftRow.user_id == resolved_user_id)
        async with self._sf() as session:
            result = await session.execute(stmt)
            return [self._row_to_dict(r) for r in result.scalars()]

    async def update(
        self,
        draft_id: int,
        *,
        project_name: str | None = None,
        doc_type: str | None = None,
        mode: str | None = None,
        stage: str | None = None,
        files: list | None = None,
        chapters: list | None = None,
        word_count_min: int | None = None,
        word_count_max: int | None = None,
        demand_input: str | None = None,
        finished: bool | None = None,
        generation_state: dict | None = None,
        model_name: str | None = None,
        kb_collection_id: str | None = None,
        user_id: str | None | _AutoSentinel = AUTO,
    ) -> dict | None:
        resolved_user_id = resolve_user_id(user_id, method_name="WritingRepository.update")
        async with self._sf() as session:
            row = await session.get(WritingDraftRow, draft_id)
            if row is None:
                return None
            if resolved_user_id is not None and row.user_id != resolved_user_id:
                return None

            if project_name is not None:
                row.project_name = project_name
            if doc_type is not None:
                row.doc_type = doc_type
            if mode is not None:
                row.mode = mode
            if stage is not None:
                row.stage = stage
            if files is not None:
                row.files = files
            if chapters is not None:
                row.chapters = chapters
            if word_count_min is not None:
                row.word_count_min = word_count_min
            if word_count_max is not None:
                row.word_count_max = word_count_max
            if demand_input is not None:
                row.demand_input = demand_input
            if finished is not None:
                row.finished = finished
            if generation_state is not None:
                row.generation_state = generation_state
            if model_name is not None:
                row.model_name = model_name
            if kb_collection_id is not None:
                row.kb_collection_id = kb_collection_id
            row.updated_at = datetime.now(UTC)
            row.version = (row.version or 0) + 1  # 乐观锁：每次写入递增版本号
            await session.commit()
            await session.refresh(row)
            return self._row_to_dict(row)

    async def delete(
        self,
        draft_id: int,
        *,
        user_id: str | None | _AutoSentinel = AUTO,
    ) -> bool:
        resolved_user_id = resolve_user_id(user_id, method_name="WritingRepository.delete")
        async with self._sf() as session:
            row = await session.get(WritingDraftRow, draft_id)
            if row is None:
                return False
            if resolved_user_id is not None and row.user_id != resolved_user_id:
                return False
            await session.delete(row)
            await session.commit()
            return True
