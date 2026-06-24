"""Knowledge Base API Router.

Provides REST endpoints for managing collections, documents,
tree indices, and executing queries (including SSE streaming).
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any, TYPE_CHECKING

if TYPE_CHECKING:
    from langchain_core.language_models import BaseChatModel

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.gateway.deps import get_config, require_min_role
from deerflow.config.app_config import AppConfig
from deerflow.knowledge_base.models import KBDocumentRow
from deerflow.knowledge_base.service import KnowledgeBaseService
from deerflow.persistence.engine import get_session_factory
from deerflow.runtime.user_context import get_effective_user_id
from deerflow.utils.file_conversion import convert_file_to_markdown
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/kb", tags=["knowledge_base"])


# ── Pydantic Models ──────────────────────────────────────────────────────────

class CollectionCreate(BaseModel):
    name: str
    description: str = ""
    metadata_schema: dict = Field(default_factory=dict)


class CollectionUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    metadata_schema: dict | None = None


class DocumentCreate(BaseModel):
    title: str
    doc_type: str = "md"
    metadata: dict = Field(default_factory=dict)
    original_filename: str | None = None


class DocumentUpdate(BaseModel):
    title: str | None = None
    metadata: dict | None = None
    status: str | None = None


class QueryRequest(BaseModel):
    collection_id: str
    query: str
    doc_ids: list[str] | None = None
    top_k: int = 3
    model_name: str = Field(default="", description="使用的模型名称，为空则使用服务端默认")


# ── Dependency ───────────────────────────────────────────────────────────────

def _get_kb_service(config: AppConfig = Depends(get_config)) -> KnowledgeBaseService:
    """Create/reuse KnowledgeBaseService instance."""
    sf = get_session_factory()
    data_dir = os.environ.get("DEER_FLOW_HOME", "/app/backend/.deer-flow")
    return KnowledgeBaseService(session_factory=sf, data_dir=data_dir, model=None)


def _create_kb_model(model_name: str, config: AppConfig) -> Any:
    """Create a LangChain chat model for the KB service."""
    try:
        from deerflow.models.factory import create_chat_model
        return create_chat_model(model_name, app_config=config)
    except Exception as e:
        logger.warning("Failed to create KB model '%s': %s", model_name, e)
        return None


# ── Helper ───────────────────────────────────────────────────────────────────

async def _ensure_user(request: Request) -> tuple[str, str]:
    """Get (user_id, system_role) from request context. Requires admin/super role."""
    user = await require_min_role(request, "admin")
    try:
        return get_effective_user_id(), user.system_role
    except Exception:
        raise HTTPException(status_code=401, detail="Unauthorized")


# ══════════════════════════════════════════════════════════════════════════════
# Collections
# ══════════════════════════════════════════════════════════════════════════════

@router.post("/collections")
async def create_collection(
    body: CollectionCreate,
    request: Request,
    kb: KnowledgeBaseService = Depends(_get_kb_service),
):
    """Create a new knowledge base collection."""
    user_id, _system_role = await _ensure_user(request)
    result = await kb.create_collection(
        user_id=user_id,
        name=body.name,
        description=body.description,
        metadata_schema=body.metadata_schema,
    )
    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])
    return result


@router.get("/collections")
async def list_collections(
    request: Request,
    kb: KnowledgeBaseService = Depends(_get_kb_service),
):
    """List all collections. Admin/super see all, regular users can't reach here."""
    user_id, system_role = await _ensure_user(request)
    # admin/super 可以看到所有 collection
    is_privileged = system_role in ("admin", "super")
    return await kb.list_collections(user_id, is_privileged=is_privileged)


@router.get("/collections/{collection_id}")
async def get_collection(
    collection_id: str,
    kb: KnowledgeBaseService = Depends(_get_kb_service),
):
    """Get a single collection."""
    result = await kb.get_collection(collection_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Collection not found")
    return result


@router.put("/collections/{collection_id}")
async def update_collection(
    collection_id: str,
    body: CollectionUpdate,
    kb: KnowledgeBaseService = Depends(_get_kb_service),
):
    """Update a collection."""
    kwargs = {k: v for k, v in body.model_dump().items() if v is not None}
    result = await kb.update_collection(collection_id, **kwargs)
    if result is None:
        raise HTTPException(status_code=404, detail="Collection not found")
    return result


@router.delete("/collections/{collection_id}")
async def delete_collection(
    collection_id: str,
    kb: KnowledgeBaseService = Depends(_get_kb_service),
):
    """Delete a collection and all its documents."""
    success = await kb.delete_collection(collection_id)
    if not success:
        raise HTTPException(status_code=404, detail="Collection not found")
    return {"success": True}


# ══════════════════════════════════════════════════════════════════════════════
# Documents
# ══════════════════════════════════════════════════════════════════════════════

@router.post("/collections/{collection_id}/documents")
async def create_document(
    collection_id: str,
    body: DocumentCreate,
    request: Request,
    kb: KnowledgeBaseService = Depends(_get_kb_service),
):
    """Create a document record (without content)."""
    user_id, _system_role = await _ensure_user(request)
    result = await kb.create_document(
        collection_id=collection_id,
        user_id=user_id,
        title=body.title,
        doc_type=body.doc_type,
        metadata=body.metadata,  # maps to custom_fields in service
        original_filename=body.original_filename,
    )
    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])
    return result


@router.get("/collections/{collection_id}/documents")
async def list_documents(
    collection_id: str,
    status: str | None = Query(None),
    kb: KnowledgeBaseService = Depends(_get_kb_service),
):
    """List documents in a collection."""
    return await kb.list_documents(collection_id, status=status)


@router.get("/documents/{doc_id}")
async def get_document(
    doc_id: str,
    kb: KnowledgeBaseService = Depends(_get_kb_service),
):
    """Get a single document."""
    result = await kb.get_document(doc_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return result


@router.put("/documents/{doc_id}")
async def update_document(
    doc_id: str,
    body: DocumentUpdate,
    kb: KnowledgeBaseService = Depends(_get_kb_service),
):
    """Update document metadata."""
    kwargs = {k: v for k, v in body.model_dump().items() if v is not None}
    # Map 'metadata' from API to 'custom_fields' in the model
    if "metadata" in kwargs:
        kwargs["custom_fields"] = kwargs.pop("metadata")
    result = await kb.update_document(doc_id, **kwargs)
    if result is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return result


@router.post("/documents/{doc_id}/delete")
async def delete_document(
    doc_id: str,
    kb: KnowledgeBaseService = Depends(_get_kb_service),
):
    """Delete a document and its tree index."""
    success = await kb.delete_document(doc_id)
    if not success:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"success": True}


@router.post("/documents/{doc_id}/upload")
async def upload_document_content(
    doc_id: str,
    background_tasks: BackgroundTasks,
    request: Request,
    kb: KnowledgeBaseService = Depends(_get_kb_service),
):
    """Upload document content (raw text or markdown) and trigger indexing in background.

    Expects JSON body: {"content": "...", "filename": "..."}
    Returns immediately — indexing runs in background.
    """
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    content = body.get("content", "")
    filename = body.get("filename", "document.md")

    if not content:
        raise HTTPException(status_code=400, detail="No content provided")

    # Save content and set status to indexing
    await kb.save_document_content(doc_id, content, filename)

    # Kick off background indexing
    background_tasks.add_task(kb.index_document_background, doc_id, content, filename)

    return {
        "success": True,
        "doc_id": doc_id,
        "status": "indexing",
        "message": "文档已保存，索引正在后台处理",
    }


@router.post("/documents/{doc_id}/upload-file")
async def upload_document_file(
    doc_id: str,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    kb: KnowledgeBaseService = Depends(_get_kb_service),
):
    """Upload a document file (PDF, DOCX, MD) and trigger background indexing.

    The file is converted to markdown (if needed), then PageIndex tree is built
    in the background. Returns immediately with status 'indexing'.
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    import os
    import shutil

    # Save uploaded file to temp location
    doc_dir = Path(kb._data_dir) / doc_id
    doc_dir.mkdir(parents=True, exist_ok=True)
    ext = os.path.splitext(file.filename)[1].lower()
    temp_path = doc_dir / f"upload{ext}"

    try:
        with temp_path.open("wb") as f:
            shutil.copyfileobj(file.file, f)

        # Determine content by converting file
        if ext in (".pdf", ".docx", ".doc", ".pptx", ".ppt", ".xlsx", ".xls"):
            md_path = await convert_file_to_markdown(temp_path)
            if md_path and os.path.exists(md_path):
                content = Path(md_path).read_text(encoding="utf-8")
                try:
                    os.unlink(md_path)
                except OSError:
                    pass
            else:
                if ext == ".pdf":
                    try:
                        import pymupdf

                        doc = pymupdf.open(str(temp_path))
                        content = ""
                        for page in doc:
                            content += page.get_text()
                        doc.close()
                    except ImportError:
                        raise HTTPException(status_code=500, detail="PDF conversion failed: no converter available")
                else:
                    raise HTTPException(status_code=400, detail=f"Unsupported file type: {ext}")
        elif ext in (".md", ".txt", ".markdown"):
            content = temp_path.read_text(encoding="utf-8")
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported file type: {ext}")

        # Update document type
        doc_type = "pdf" if ext == ".pdf" else "md"
        await kb.update_document(doc_id, doc_type=doc_type, original_filename=file.filename)

        # Save content and kick off background indexing
        await kb.save_document_content(doc_id, content, file.filename)
        background_tasks.add_task(kb.index_document_background, doc_id, content, file.filename)

        return {
            "success": True,
            "doc_id": doc_id,
            "status": "indexing",
            "message": "文件已保存，索引正在后台处理",
        }

    finally:
        try:
            if temp_path.exists():
                os.unlink(temp_path)
        except OSError:
            pass


@router.post("/documents/{doc_id}/index")
async def index_document(
    doc_id: str,
    background_tasks: BackgroundTasks,
    kb: KnowledgeBaseService = Depends(_get_kb_service),
):
    """Re-index a document from its stored content (background)."""
    doc = await kb.get_document(doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")

    doc_dir = Path(kb._data_dir) / doc_id
    md_path = doc_dir / "document.md"

    if not md_path.exists():
        raise HTTPException(
            status_code=400,
            detail="No content file found for this document. Upload content first.",
        )

    content = md_path.read_text(encoding="utf-8")
    filename = doc.get("original_filename", "document.md")

    # Set status to indexing and kick off background task
    await kb.update_document(doc_id, status="indexing")
    background_tasks.add_task(kb.index_document_background, doc_id, content, filename)

    return {
        "success": True,
        "doc_id": doc_id,
        "status": "indexing",
        "message": "重新索引已开始，后台处理中",
    }


@router.get("/documents/{doc_id}/download")
async def download_document(
    doc_id: str,
    kb: KnowledgeBaseService = Depends(_get_kb_service),
):
    """Download the original document content as a text file."""
    from fastapi.responses import PlainTextResponse

    doc = await kb.get_document(doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")

    doc_dir = Path(kb._data_dir) / doc_id
    md_path = doc_dir / "document.md"

    if not md_path.exists():
        raise HTTPException(status_code=404, detail="Document content not found")

    content = md_path.read_text(encoding="utf-8")
    filename = doc.get("original_filename", f"{doc.get('title', 'document')}.md")

    from urllib.parse import quote

    safe_filename = quote(filename or "document.md")
    return PlainTextResponse(
        content=content,
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{safe_filename}",
            "Content-Type": "text/markdown; charset=utf-8",
        },
    )


@router.get("/documents/{doc_id}/tree")
async def get_document_tree(
    doc_id: str,
    structure_only: bool = Query(False, description="Exclude text content"),
    kb: KnowledgeBaseService = Depends(_get_kb_service),
):
    """Get the PageIndex tree for a document."""
    if structure_only:
        result = await kb.get_tree_structure_only(doc_id)
    else:
        result = await kb.get_tree(doc_id)

    if result is None:
        raise HTTPException(status_code=404, detail="Tree not found")
    return result


# ══════════════════════════════════════════════════════════════════════════════
# Query
# ══════════════════════════════════════════════════════════════════════════════

@router.post("/query")
async def query_knowledge_base(
    body: QueryRequest,
    kb: KnowledgeBaseService = Depends(_get_kb_service),
    config: AppConfig = Depends(get_config),
):
    """Query the knowledge base.

    Full pipeline: route → tree search → generate answer.
    """
    model = None
    if body.model_name:
        model = _create_kb_model(body.model_name, config)

    result = await kb.query(
        collection_id=body.collection_id,
        query_text=body.query,
        doc_ids=body.doc_ids,
        top_k=body.top_k,
        model=model,
    )
    return result


@router.post("/query/stream")
async def query_knowledge_base_stream(
    body: QueryRequest,
    kb: KnowledgeBaseService = Depends(_get_kb_service),
    config: AppConfig = Depends(get_config),
):
    """Stream the knowledge base query result via SSE.

    Events:
    - routing: candidate documents found
    - search: tree search results per document
    - context: extracted context summary
    - token: answer text tokens (streaming)
    - done: query complete
    - error: error occurred
    """
    model = None
    if body.model_name:
        model = _create_kb_model(body.model_name, config)

    async def event_generator():
        async for event in kb.query_stream(
            collection_id=body.collection_id,
            query_text=body.query,
            doc_ids=body.doc_ids,
            model=model,
        ):
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ══════════════════════════════════════════════════════════════════════════════
# Health
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/health")
async def kb_health():
    """Knowledge base health check."""
    return {"status": "ok", "service": "knowledge_base"}
