"""In-memory WritingStore for development/testing when database.backend=memory."""

from __future__ import annotations

from typing import Any

from deerflow.persistence.writing.base import WritingStore
from deerflow.runtime.user_context import AUTO, _AutoSentinel, resolve_user_id
from deerflow.utils.time import now_iso


class MemoryWritingStore(WritingStore):
    def __init__(self) -> None:
        self._drafts: dict[int, dict] = {}
        self._next_id = 1

    async def create(
        self,
        *,
        project_name: str = "",
        doc_type: str = "report",
        mode: str | None = None,
        user_id: str | None | _AutoSentinel = AUTO,
    ) -> dict:
        resolved_user_id = resolve_user_id(user_id, method_name="MemoryWritingStore.create")
        now = now_iso()
        draft_id = self._next_id
        self._next_id += 1
        draft: dict[str, Any] = {
            "id": draft_id,
            "user_id": resolved_user_id,
            "project_name": project_name,
            "doc_type": doc_type,
            "mode": mode,
            "stage": "start",
            "files": [],
            "chapters": [],
            "word_count_min": 0,
            "word_count_max": 0,
            "demand_input": "",
            "finished": False,
            "generation_state": {
                "status": "idle",
                "pending_chapters": [],
                "failed_chapters": [],
                "generated_chapters": [],
            },
            "created_at": now,
            "updated_at": now,
        }
        self._drafts[draft_id] = draft
        return dict(draft)

    async def get(
        self,
        draft_id: int,
        *,
        user_id: str | None | _AutoSentinel = AUTO,
    ) -> dict | None:
        resolved_user_id = resolve_user_id(user_id, method_name="MemoryWritingStore.get")
        draft = self._drafts.get(draft_id)
        if draft is None:
            return None
        if resolved_user_id is not None and draft["user_id"] != resolved_user_id:
            return None
        return dict(draft)

    async def list_drafts(
        self,
        *,
        limit: int = 50,
        offset: int = 0,
        user_id: str | None | _AutoSentinel = AUTO,
    ) -> list[dict]:
        resolved_user_id = resolve_user_id(user_id, method_name="MemoryWritingStore.list_drafts")
        drafts = list(self._drafts.values())
        if resolved_user_id is not None:
            drafts = [d for d in drafts if d["user_id"] == resolved_user_id]
        drafts.sort(key=lambda d: d["updated_at"], reverse=True)
        return [dict(d) for d in drafts[offset : offset + limit]]

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
        resolved_user_id = resolve_user_id(user_id, method_name="MemoryWritingStore.update")
        draft = self._drafts.get(draft_id)
        if draft is None:
            return None
        if resolved_user_id is not None and draft["user_id"] != resolved_user_id:
            return None

        if project_name is not None:
            draft["project_name"] = project_name
        if doc_type is not None:
            draft["doc_type"] = doc_type
        if mode is not None:
            draft["mode"] = mode
        if stage is not None:
            draft["stage"] = stage
        if files is not None:
            draft["files"] = files
        if chapters is not None:
            draft["chapters"] = chapters
        if word_count_min is not None:
            draft["word_count_min"] = word_count_min
        if word_count_max is not None:
            draft["word_count_max"] = word_count_max
        if demand_input is not None:
            draft["demand_input"] = demand_input
        if finished is not None:
            draft["finished"] = finished
        if generation_state is not None:
            draft["generation_state"] = generation_state
        if model_name is not None:
            draft["model_name"] = model_name
        if kb_collection_id is not None:
            draft["kb_collection_id"] = kb_collection_id
        draft["_version"] = draft.get("_version", 0) + 1  # 乐观锁：每次写入递增版本号
        draft["updated_at"] = now_iso()
        return dict(draft)

    async def delete(
        self,
        draft_id: int,
        *,
        user_id: str | None | _AutoSentinel = AUTO,
    ) -> bool:
        resolved_user_id = resolve_user_id(user_id, method_name="MemoryWritingStore.delete")
        draft = self._drafts.get(draft_id)
        if draft is None:
            return False
        if resolved_user_id is not None and draft["user_id"] != resolved_user_id:
            return False
        del self._drafts[draft_id]
        return True
