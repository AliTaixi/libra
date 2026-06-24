"""Abstract interface for writing draft storage.

Implementations:
- WritingRepository: SQL-backed (sqlite / postgres via SQLAlchemy)
- MemoryWritingStore: in-memory (memory mode)
"""

from __future__ import annotations

import abc

from deerflow.runtime.user_context import AUTO, _AutoSentinel


class WritingStore(abc.ABC):
    @abc.abstractmethod
    async def create(
        self,
        *,
        project_name: str = "",
        doc_type: str = "report",
        mode: str | None = None,
        user_id: str | None | _AutoSentinel = AUTO,
    ) -> dict:
        """Create a new writing draft. Returns the created draft dict."""
        pass

    @abc.abstractmethod
    async def get(
        self,
        draft_id: int,
        *,
        user_id: str | None | _AutoSentinel = AUTO,
    ) -> dict | None:
        """Get a draft by ID. Returns None if not found or access denied."""
        pass

    @abc.abstractmethod
    async def list_drafts(
        self,
        *,
        limit: int = 50,
        offset: int = 0,
        user_id: str | None | _AutoSentinel = AUTO,
    ) -> list[dict]:
        """List drafts for a user, ordered by updated_at desc."""
        pass

    @abc.abstractmethod
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
        """Update draft fields. Returns updated draft or None if not found."""
        pass

    @abc.abstractmethod
    async def delete(
        self,
        draft_id: int,
        *,
        user_id: str | None | _AutoSentinel = AUTO,
    ) -> bool:
        """Delete a draft. Returns True if deleted, False if not found."""
        pass
