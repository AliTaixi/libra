"""Knowledge Base service — document management, tree building, and query pipeline.

This is the core business logic layer for the PageIndex-based knowledge base.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import uuid
from pathlib import Path
from typing import Any

from sqlalchemy import select, delete, func, and_
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from deerflow.knowledge_base.models import (
    KBChunkRow,
    KBCollectionRow,
    KBDocumentRow,
    KBTreeIndexRow,
)
from deerflow.knowledge_base.pageindex_engine import (
    md_to_tree,
    structure_to_list,
)
from deerflow.knowledge_base.tree_search import tree_search_pipeline

logger = logging.getLogger(__name__)


class KnowledgeBaseService:
    """Service for managing knowledge base collections, documents, and queries."""

    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession] | None,
        data_dir: str = "",
        model: Any = None,
    ) -> None:
        self._sf = session_factory
        self._data_dir = Path(data_dir) / "kb"
        self._data_dir.mkdir(parents=True, exist_ok=True)
        # The LLM model instance for tree building, search, and generation
        self._model = model

    # ── Collections ──────────────────────────────────────────────────────────

    async def create_collection(
        self,
        user_id: str,
        name: str,
        description: str = "",
        metadata_schema: dict | None = None,
    ) -> dict:
        """Create a new knowledge base collection."""
        if self._sf is None:
            return {"error": "Database not available"}

        collection = KBCollectionRow(
            user_id=user_id,
            name=name,
            description=description,
            metadata_schema=metadata_schema or {},
        )
        async with self._sf() as session:
            session.add(collection)
            await session.commit()
            await session.refresh(collection)
            return collection.to_dict()

    async def list_collections(self, user_id: str, is_privileged: bool = False) -> list[dict]:
        """List all collections for a user.
        
        Args:
            user_id: The user's ID.
            is_privileged: If True (admin/super), return all collections regardless of owner.
        """
        if self._sf is None:
            return []
        async with self._sf() as session:
            query = select(KBCollectionRow)
            if not is_privileged:
                query = query.where(KBCollectionRow.user_id == user_id)
            query = query.order_by(KBCollectionRow.updated_at.desc())
            result = await session.execute(query)
            rows = result.scalars().all()
            # Also count documents per collection
            collections = []
            for row in rows:
                d = row.to_dict()
                count = await session.execute(
                    select(func.count(KBDocumentRow.id))
                    .where(KBDocumentRow.collection_id == row.id)
                )
                d["document_count"] = count.scalar() or 0
                collections.append(d)
            return collections

    async def get_collection(self, collection_id: str) -> dict | None:
        """Get a single collection."""
        if self._sf is None:
            return None
        async with self._sf() as session:
            result = await session.execute(
                select(KBCollectionRow).where(KBCollectionRow.id == collection_id)
            )
            row = result.scalar_one_or_none()
            if row is None:
                return None
            d = row.to_dict()
            count = await session.execute(
                select(func.count(KBDocumentRow.id))
                .where(KBDocumentRow.collection_id == row.id)
            )
            d["document_count"] = count.scalar() or 0
            return d

    async def update_collection(
        self, collection_id: str, **kwargs
    ) -> dict | None:
        """Update a collection."""
        if self._sf is None:
            return None
        async with self._sf() as session:
            result = await session.execute(
                select(KBCollectionRow).where(KBCollectionRow.id == collection_id)
            )
            row = result.scalar_one_or_none()
            if row is None:
                return None
            for key, value in kwargs.items():
                if hasattr(row, key):
                    setattr(row, key, value)
            await session.commit()
            await session.refresh(row)
            return row.to_dict()

    async def delete_collection(self, collection_id: str) -> bool:
        """Delete a collection and all its documents and indices."""
        if self._sf is None:
            return False
        async with self._sf() as session:
            # Get all document IDs in this collection
            doc_result = await session.execute(
                select(KBDocumentRow.id).where(
                    KBDocumentRow.collection_id == collection_id
                )
            )
            doc_ids = [row[0] for row in doc_result.all()]

            if doc_ids:
                # Delete tree indices
                await session.execute(
                    delete(KBTreeIndexRow).where(
                        KBTreeIndexRow.doc_id.in_(doc_ids)
                    )
                )
                # Delete chunks
                await session.execute(
                    delete(KBChunkRow).where(KBChunkRow.doc_id.in_(doc_ids))
                )
                # Delete documents
                await session.execute(
                    delete(KBDocumentRow).where(
                        KBDocumentRow.collection_id == collection_id
                    )
                )
                # Delete files
                for doc_id in doc_ids:
                    doc_dir = self._data_dir / doc_id
                    if doc_dir.exists():
                        shutil.rmtree(doc_dir)

            # Delete collection
            await session.execute(
                delete(KBCollectionRow).where(
                    KBCollectionRow.id == collection_id
                )
            )
            await session.commit()
            return True

    # ── Documents ────────────────────────────────────────────────────────────

    async def create_document(
        self,
        collection_id: str,
        user_id: str,
        title: str,
        doc_type: str = "md",
        metadata: dict | None = None,
        original_filename: str | None = None,
    ) -> dict:
        """Create a document record."""
        if self._sf is None:
            return {"error": "Database not available"}

        doc = KBDocumentRow(
            collection_id=collection_id,
            user_id=user_id,
            title=title,
            doc_type=doc_type,
            doc_format="markdown" if doc_type in ("md", "markdown") else doc_type,
            custom_fields=metadata or {},
            original_filename=original_filename or f"{title}.{doc_type}",
            status="pending",
        )
        async with self._sf() as session:
            session.add(doc)
            await session.commit()
            await session.refresh(doc)
            return doc.to_dict()

    async def list_documents(
        self,
        collection_id: str,
        status: str | None = None,
    ) -> list[dict]:
        """List documents in a collection."""
        if self._sf is None:
            return []
        async with self._sf() as session:
            query = select(KBDocumentRow).where(
                KBDocumentRow.collection_id == collection_id
            )
            if status:
                query = query.where(KBDocumentRow.status == status)
            query = query.order_by(KBDocumentRow.updated_at.desc())

            result = await session.execute(query)
            rows = result.scalars().all()
            return [row.to_dict() for row in rows]

    async def get_document(self, doc_id: str) -> dict | None:
        """Get a single document."""
        if self._sf is None:
            return None
        async with self._sf() as session:
            result = await session.execute(
                select(KBDocumentRow).where(KBDocumentRow.id == doc_id)
            )
            row = result.scalar_one_or_none()
            return row.to_dict() if row else None

    async def update_document(self, doc_id: str, **kwargs) -> dict | None:
        """Update document metadata."""
        if self._sf is None:
            return None
        async with self._sf() as session:
            result = await session.execute(
                select(KBDocumentRow).where(KBDocumentRow.id == doc_id)
            )
            row = result.scalar_one_or_none()
            if row is None:
                return None
            for key, value in kwargs.items():
                if hasattr(row, key):
                    setattr(row, key, value)
            await session.commit()
            await session.refresh(row)
            return row.to_dict()

    async def delete_document(self, doc_id: str) -> bool:
        """Delete a document and its tree index."""
        if self._sf is None:
            return False
        async with self._sf() as session:
            # Delete tree index
            await session.execute(
                delete(KBTreeIndexRow).where(KBTreeIndexRow.doc_id == doc_id)
            )
            # Delete chunks
            await session.execute(
                delete(KBChunkRow).where(KBChunkRow.doc_id == doc_id)
            )
            # Delete document
            await session.execute(
                delete(KBDocumentRow).where(KBDocumentRow.id == doc_id)
            )
            await session.commit()

        # Delete files
        doc_dir = self._data_dir / doc_id
        if doc_dir.exists():
            shutil.rmtree(doc_dir)
        return True

    # ── Tree Building Pipeline ───────────────────────────────────────────────

    async def index_document(
        self,
        doc_id: str,
        content: str,
        filename: str = "",
    ) -> dict:
        """Build PageIndex tree for a document.

        Steps:
        1. Save content to a markdown file
        2. Run md_to_tree() to build the tree
        3. Store tree index in database
        4. Extract and cache node chunks
        5. Update document status to 'ready'

        Args:
            doc_id: Document UUID.
            content: Document text content (markdown).
            filename: Original filename (for reference).

        Returns:
            Dict with indexing result.
        """
        if self._sf is None:
            return {"error": "Database not available"}

        # Save markdown content to data directory
        doc_dir = self._data_dir / doc_id
        doc_dir.mkdir(parents=True, exist_ok=True)
        md_path = doc_dir / "document.md"
        md_path.write_text(content, encoding="utf-8")

        try:
            # Update status to 'indexing'
            await self.update_document(doc_id, status="indexing")

            # Build tree index
            tree_result = await md_to_tree(
                md_path=str(md_path),
                if_thinning=True,
                min_token_threshold=5000,
                if_add_node_summary="yes",
                summary_token_threshold=200,
                model=self._model,
                if_add_doc_description="yes",
                if_add_node_text="yes",
                if_add_node_id="yes",
            )

            structure = tree_result.get("structure", [])
            line_count = tree_result.get("line_count", 0)
            doc_description = tree_result.get("doc_description", "")

            # Count nodes and depth
            all_nodes = structure_to_list(structure)
            node_count = len(all_nodes)
            depth = 0
            for node in all_nodes:
                if node.get("nodes"):
                    d = _calc_depth(node)
                    depth = max(depth, d)

            # Calculate total token count
            total_tokens = sum(
                len(node.get("text", "")) // 4 for node in all_nodes
            )

            # Store tree index in database
            async with self._sf() as session:
                # Remove existing index if any
                await session.execute(
                    delete(KBTreeIndexRow).where(
                        KBTreeIndexRow.doc_id == doc_id
                    )
                )
                tree_index = KBTreeIndexRow(
                    doc_id=doc_id,
                    tree_json=tree_result,
                    depth=depth,
                    node_count=node_count,
                )
                session.add(tree_index)

                # Cache node chunks
                await session.execute(
                    delete(KBChunkRow).where(KBChunkRow.doc_id == doc_id)
                )
                for node in all_nodes:
                    chunk = KBChunkRow(
                        doc_id=doc_id,
                        node_id=node.get("node_id", ""),
                        title=node.get("title", ""),
                        page_range=str(node.get("line_num", "")),
                        content=node.get("text", ""),
                        token_count=len(node.get("text", "")) // 4,
                        summary=node.get("summary", "")
                        or node.get("prefix_summary", ""),
                    )
                    session.add(chunk)

                await session.commit()

            # Update document status
            await self.update_document(
                doc_id,
                status="ready",
                doc_description=doc_description,
                line_count=line_count,
                token_count=total_tokens,
            )

            return {
                "success": True,
                "doc_id": doc_id,
                "node_count": node_count,
                "depth": depth,
                "line_count": line_count,
                "token_count": total_tokens,
                "doc_description": doc_description,
            }

        except Exception as e:
            logger.error("Failed to index document %s: %s", doc_id, e)
            await self.update_document(
                doc_id, status="failed", error_message=str(e)
            )
            return {"success": False, "error": str(e)}

    async def get_tree(self, doc_id: str) -> dict | None:
        """Get the tree index for a document.

        Returns the full tree JSON (including text for search).
        """
        if self._sf is None:
            return None
        async with self._sf() as session:
            result = await session.execute(
                select(KBTreeIndexRow).where(
                    KBTreeIndexRow.doc_id == doc_id
                )
            )
            row = result.scalar_one_or_none()
            return row.tree_json if row else None

    async def get_tree_structure_only(self, doc_id: str) -> dict | None:
        """Get tree structure WITHOUT text (for LLM navigation, saves tokens)."""
        from deerflow.knowledge_base.pageindex_engine.utils import (
            remove_structure_text,
        )

        tree = await self.get_tree(doc_id)
        if tree is None:
            return None

        structure = tree.get("structure", [])
        structure_no_text = remove_structure_text(structure)
        result = dict(tree)
        result["structure"] = structure_no_text
        return result

    # ── Background Indexing ──────────────────────────────────────────────────

    async def save_document_content(
        self,
        doc_id: str,
        content: str,
        filename: str = "",
    ) -> None:
        """Save document content to disk and set status to 'indexing'.

        Returns immediately — use index_document_background() for actual indexing.
        """
        doc_dir = self._data_dir / doc_id
        doc_dir.mkdir(parents=True, exist_ok=True)
        md_path = doc_dir / "document.md"
        md_path.write_text(content, encoding="utf-8")

        # Update status to indexing
        await self.update_document(doc_id, status="indexing")

    async def index_document_background(
        self,
        doc_id: str,
        content: str,
        filename: str = "",
    ) -> None:
        """Index a document in the background. Safe to call as a background task.

        Handles all errors internally (sets status to 'failed' on error).
        """
        import asyncio
        import logging

        logger = logging.getLogger(__name__)

        try:
            # Small delay to let the HTTP response return first
            await asyncio.sleep(0.1)

            result = await self.index_document(
                doc_id=doc_id,
                content=content,
                filename=filename,
            )
            if result.get("success"):
                logger.info("Background indexing complete for doc %s", doc_id)
            else:
                logger.error(
                    "Background indexing failed for doc %s: %s",
                    doc_id,
                    result.get("error"),
                )
        except Exception as e:
            logger.exception("Background indexing crashed for doc %s: %s", doc_id, e)
            try:
                await self.update_document(doc_id, status="failed", error_message=str(e))
            except Exception:
                pass

    # ── Query Pipeline ───────────────────────────────────────────────────────

    async def route_query(
        self,
        collection_id: str,
        query_text: str,
    ) -> list[dict]:
        """Step 1: Use LLM to extract metadata filters from query text,
        then find matching documents.

        Returns list of candidate docs.
        """
        if self._sf is None:
            return []

        # Get collection (for metadata schema)
        collection = await self.get_collection(collection_id)
        if not collection:
            return []

        # Get all documents in the collection
        documents = await self.list_documents(collection_id, status="ready")
        if not documents:
            return []

        # Use LLM to extract metadata filters from query
        filters = await self._extract_metadata_filters(query_text)
        logger.debug("Extracted filters: %s", filters)

        if not filters or not any(filters.values()):
            # No filters extracted — return all documents
            return documents

        # Apply filters against document metadata
        candidates = []
        for doc in documents:
            doc_meta = doc.get("custom_fields", {}) or {}
            match = True
            for key, value in filters.items():
                if not value:
                    continue
                doc_val = doc_meta.get(key) or doc.get(key)
                if doc_val is None:
                    doc_val = doc.get(key)  # Fall back to document fields
                if doc_val is None:
                    match = False
                    break
                if isinstance(value, str) and isinstance(doc_val, str):
                    if value.lower() not in doc_val.lower():
                        match = False
                        break
                elif isinstance(value, (int, float)):
                    if doc_val != value:
                        match = False
                        break
            if match:
                candidates.append(doc)

        return candidates or documents  # Fall back to all if no match

    async def _extract_metadata_filters(
        self, query_text: str
    ) -> dict[str, Any]:
        """Use LLM to extract metadata filter fields from natural language query.

        Example: "英伟达2025年年报的营收情况"
        → {"firm": "英伟达", "doc_type": "年报", "year": 2025}
        """
        if self._model is None:
            return {}

        prompt = f"""Extract metadata filter fields from the following user query.
The query is about finding documents in a knowledge base.
Identify any fields like: company/firm name, document type, year, author, tags, etc.

Return ONLY a JSON object with the extracted fields (empty string for unknown fields).
Be conservative — only extract fields that are explicitly mentioned.

Query: {query_text}

JSON:"""

        try:
            from langchain_core.messages import HumanMessage

            response = await self._model.ainvoke([HumanMessage(content=prompt)])
            content = (
                response.content.strip()
                if hasattr(response, "content")
                else str(response)
            )

            from deerflow.knowledge_base.pageindex_engine.utils import (
                extract_json,
            )

            result = extract_json(content)
            if isinstance(result, dict):
                return result
            return {}
        except Exception as e:
            logger.warning("Failed to extract metadata filters: %s", e)
            return {}

    async def query(
        self,
        collection_id: str,
        query_text: str,
        doc_ids: list[str] | None = None,
        top_k: int = 3,
        model: Any = None,
    ) -> dict:
        """Full query pipeline:
        1. Route to candidate documents (metadata filters)
        2. For each candidate, run tree search
        3. Generate final answer
        """
        if self._sf is None:
            return {"error": "Database not available"}

        # Determine effective model (per-query override or service default)
        effective_model = model if model is not None else self._model

        # Step 1: Route to candidate documents
        if doc_ids:
            candidates = []
            for did in doc_ids:
                doc = await self.get_document(did)
                if doc:
                    candidates.append(doc)
        else:
            candidates = await self.route_query(collection_id, query_text)

        if not candidates:
            return {
                "answer": "没有找到相关文档。",
                "sources": [],
            }

        # Step 2: Tree search on each candidate
        sources = []
        all_contexts = []

        for doc in candidates[:top_k]:
            doc_id = doc["id"]
            tree = await self.get_tree(doc_id)
            if tree is None:
                continue

            structure = tree.get("structure", [])
            doc_description = tree.get("doc_description", "")
            doc_name = tree.get("doc_name", doc.get("title", ""))

            # Tree search
            search_result = await tree_search_pipeline(
                structure=structure,
                query=query_text,
                model=effective_model,
                max_nodes=5,
            )

            # Extract content from matched nodes
            matched_content = await self._extract_node_content(
                doc_id, search_result.get("matched_node_ids", [])
            )

            source = {
                "doc_id": doc_id,
                "doc_name": doc_name,
                "doc_description": doc_description,
                "matched_nodes": search_result.get("matched_node_ids", []),
                "content": matched_content,
            }
            sources.append(source)
            if matched_content:
                all_contexts.append(matched_content)

        # Step 3: Generate answer from all contexts
        context_text = "\n\n---\n\n".join(all_contexts) if all_contexts else ""

        answer = await self._generate_answer(
            query_text=query_text,
            context=context_text,
            sources=sources,
            model=effective_model,
        )

        return {
            "answer": answer,
            "sources": [
                {
                    "doc_id": s["doc_id"],
                    "doc_name": s["doc_name"],
                    "doc_description": s.get("doc_description", ""),
                }
                for s in sources
            ],
            "candidate_count": len(candidates),
        }

    async def query_stream(
        self,
        collection_id: str,
        query_text: str,
        doc_ids: list[str] | None = None,
        model: Any = None,
    ):
        """Stream the full query pipeline as an SSE event stream.

        Yields dict events:
        - {"type": "routing", "documents": [...]}
        - {"type": "search", "doc_id": "...", "nodes": [...]}
        - {"type": "context", "content": "..."}
        - {"type": "token", "text": "..."}  (streaming answer tokens)
        - {"type": "done", "sources": [...]}
        """
        effective_model = model if model is not None else self._model

        if self._sf is None:
            yield {"type": "error", "message": "Database not available"}
            return

        # Step 1: Route
        if doc_ids:
            candidates = []
            for did in doc_ids:
                doc = await self.get_document(did)
                if doc:
                    candidates.append(doc)
        else:
            candidates = await self.route_query(collection_id, query_text)

        yield {
            "type": "routing",
            "documents": [
                {
                    "doc_id": d["id"],
                    "doc_name": d.get("title", d.get("original_filename", "")),
                    "doc_description": d.get("doc_description", ""),
                }
                for d in candidates
            ],
        }

        if not candidates:
            yield {"type": "token", "text": "没有找到相关文档。"}
            yield {"type": "done", "sources": []}
            return

        # Step 2: Tree search
        all_contexts = []
        sources = []

        for doc in candidates[:3]:
            doc_id = doc["id"]
            tree = await self.get_tree(doc_id)
            if tree is None:
                continue

            structure = tree.get("structure", [])
            doc_description = tree.get("doc_description", "")
            doc_name = tree.get("doc_name", doc.get("title", ""))

            search_result = await tree_search_pipeline(
                structure=structure,
                query=query_text,
                model=effective_model,
                max_nodes=5,
            )

            matched_content = await self._extract_node_content(
                doc_id, search_result.get("matched_node_ids", [])
            )

            yield {
                "type": "search",
                "doc_id": doc_id,
                "doc_name": doc_name,
                "nodes": search_result.get("matched_node_ids", []),
            }

            source = {
                "doc_id": doc_id,
                "doc_name": doc_name,
                "doc_description": doc_description,
                "matched_nodes": search_result.get("matched_node_ids", []),
                "content": matched_content,
            }
            sources.append(source)
            if matched_content:
                all_contexts.append(matched_content)

        context_text = "\n\n---\n\n".join(all_contexts) if all_contexts else ""

        yield {"type": "context", "content": context_text[:500]}

        # Step 3: Stream answer
        if effective_model and hasattr(effective_model, "astream"):
            from langchain_core.messages import HumanMessage, SystemMessage

            system_prompt = """You are a helpful document analysis assistant. Answer the user's question based on the provided document context. If the context doesn't contain enough information to answer, say so. Always cite which document section you used. Answer in the same language as the question."""

            source_list = "\n".join(
                f"- {s['doc_name']}: {s['doc_description']}"
                for s in sources
                if s.get("doc_description")
            )

            context_prompt = f"""Context from documents:
{context_text}

Sources:
{source_list}

Question: {query_text}"""

            async for chunk in effective_model.astream(
                [
                    SystemMessage(content=system_prompt),
                    HumanMessage(content=context_prompt),
                ]
            ):
                content = (
                    chunk.content
                    if hasattr(chunk, "content")
                    else str(chunk)
                )
                if content:
                    yield {"type": "token", "text": content}
        else:
            answer_text = await self._generate_answer(
                query_text, context_text, sources, model=effective_model
            )
            yield {"type": "token", "text": answer_text}

        yield {"type": "done", "sources": sources}

    async def _extract_node_content(
        self, doc_id: str, node_ids: list[str]
    ) -> str:
        """Extract content text for specific node IDs from the chunk cache."""
        if self._sf is None or not node_ids:
            return ""

        async with self._sf() as session:
            result = await session.execute(
                select(KBChunkRow).where(
                    and_(
                        KBChunkRow.doc_id == doc_id,
                        KBChunkRow.node_id.in_(node_ids),
                    )
                )
            )
            chunks = result.scalars().all()

        parts = []
        for chunk in chunks:
            title = chunk.title or ""
            content = chunk.content or ""
            if title and content:
                parts.append(f"## {title}\n\n{content}")
            elif content:
                parts.append(content)

        return "\n\n".join(parts)

    async def _generate_answer(
        self,
        query_text: str,
        context: str,
        sources: list[dict],
        model: Any = None,
    ) -> str:
        """Generate final answer from context and query."""
        effective_model = model if model is not None else self._model
        if effective_model is None:
            return "模型未配置。"

        if not context:
            return "在相关文档中未找到匹配的内容。"

        from langchain_core.messages import HumanMessage, SystemMessage

        system_prompt = """You are a helpful document analysis assistant. Answer the user's question based on the provided document context. If the context doesn't contain enough information to answer, say so. Always cite which document section you used. Answer in the same language as the question."""

        source_list = "\n".join(
            f"- {s['doc_name']}: {s.get('doc_description', '')}"
            for s in sources
            if s.get("doc_description")
        )

        context_prompt = f"""Context from documents:
{context}

Sources:
{source_list}

Question: {query_text}"""

        try:
            response = await effective_model.ainvoke(
                [
                    SystemMessage(content=system_prompt),
                    HumanMessage(content=context_prompt),
                ]
            )
            return (
                response.content.strip()
                if hasattr(response, "content")
                else str(response)
            )
        except Exception as e:
            logger.error("Failed to generate answer: %s", e)
            return f"生成答案时出错: {e}"


def _calc_depth(node: dict, current_depth: int = 0) -> int:
    """Calculate max depth of a tree node."""
    children = node.get("nodes", [])
    if not children:
        return current_depth
    return max(_calc_depth(child, current_depth + 1) for child in children)
