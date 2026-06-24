"""Knowledge Base tool for DeerFlow AI agents.

This tool allows the AI agent to query the knowledge base during
chat conversations and full-text writing workflows.
"""

from __future__ import annotations

import logging
from typing import Any

from langchain_core.tools import tool

from deerflow.config import get_app_config
from deerflow.knowledge_base.service import KnowledgeBaseService
from deerflow.models.factory import create_chat_model
from deerflow.persistence.engine import get_session_factory

logger = logging.getLogger(__name__)

# Lazy-init singleton
_kb_service: KnowledgeBaseService | None = None


def _get_kb_service() -> KnowledgeBaseService | None:
    """Get or create the KB service singleton."""
    global _kb_service
    if _kb_service is not None:
        return _kb_service

    try:
        sf = get_session_factory()
        if sf is None:
            logger.warning("KB tool: database not available")
            return None

        config = get_app_config()
        data_dir = getattr(config, "data_dir", "/app/backend/.deer-flow")

        # Get model from KB config
        kb_config = getattr(config, "knowledge_base", None) or {}
        model_name = kb_config.get("model", "gemma4-local")
        model = None
        try:
            model = create_chat_model(model_name, app_config=config)
        except Exception as e:
            logger.warning("KB tool: failed to create model '%s': %s", model_name, e)

        _kb_service = KnowledgeBaseService(
            session_factory=sf,
            data_dir=data_dir,
            model=model,
        )
        return _kb_service
    except Exception as e:
        logger.error("KB tool: failed to initialize: %s", e)
        return None


@tool
async def kb_search_documents(query: str, collection_id: str | None = None) -> str:
    """Search documents in the knowledge base and return relevant information.

    Use this tool when the user asks a question that might be answered by
    documents in the knowledge base (reports, manuals, reference materials).

    Args:
        query: The user's question or search query.
        collection_id: Optional collection ID to limit the search scope.

    Returns:
        Answer based on knowledge base documents.
    """
    service = _get_kb_service()
    if service is None:
        return "知识库不可用（数据库未连接）。"

    try:
        # If no collection_id specified, use the first available collection
        if not collection_id:
            from deerflow.persistence.engine import get_session_factory
            from sqlalchemy import select
            from deerflow.knowledge_base.models import KBCollectionRow

            sf = get_session_factory()
            if sf:
                async with sf() as session:
                    result = await session.execute(
                        select(KBCollectionRow.id).limit(1)
                    )
                    row = result.scalar_one_or_none()
                    if row:
                        collection_id = row

        if not collection_id:
            return "知识库中没有找到任何集合。请先在知识库中创建集合并上传文档。"

        result = await service.query(
            collection_id=collection_id,
            query_text=query,
            top_k=3,
        )

        answer = result.get("answer", "")
        sources = result.get("sources", [])

        if not answer:
            return "在知识库中未找到相关信息。"

        # Append source references
        if sources:
            source_refs = "\n\n来源:\n" + "\n".join(
                f"- {s.get('doc_name', 'unknown')}" for s in sources
            )
            answer += source_refs

        return answer
    except Exception as e:
        logger.error("KB search failed: %s", e)
        return f"知识库查询失败: {e}"


# Export for config.yaml registration
kb_query_tool = kb_search_documents
