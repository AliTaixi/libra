"""草稿 CRUD — 薄路由层，持久化在 app.gateway.deps，AI 逻辑在 deerflow.writing.service。"""

from __future__ import annotations

import asyncio
import copy
import json
import logging
import os
import random
import shutil
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, UploadFile, File
from fastapi.responses import StreamingResponse

from app.gateway.deps import get_writing_store
from deerflow.persistence.writing.base import WritingStore

from .models import (
    DraftCreateRequest, DraftUpdateRequest, DraftResponse,
    DraftListResponse, DraftDeleteResponse, ResumeResponse, StatusResponse,
)
from deerflow.writing.service import (
    WritingError,
    call_llm, md_to_html,
    generate_title as svc_generate_title,
    background_generate_chapter,
    _user_data_dir, _upload_dir, _ensure_output_dir,
)
from deerflow.writing.kb_context import KBContextResolver

logger = logging.getLogger("app.gateway.routers.writing")
router = APIRouter()


def _is_placeholder_content(content: str) -> bool:
    """检查内容是否为占位符/错误（非真正生成的内容），用于跳过检查时区分真实内容和占位符。
    
    与前端 isContentEffectivelyEmpty 保持逻辑一致：
    - 空内容
    - 包含占位符文本（"待撰写"、"生成失败"等）
    - 不包含 <p> 标签（没有正文段落，全是标题结构）
    """
    if not content or not content.strip():
        return True
    if "本节内容待撰写" in content or "待撰写" in content:
        return True
    if "生成失败" in content:
        return True
    if "<p>" not in content:  # 无 <p> 标签 = 没有正文段落
        return True
    return False


def _to_http(e: WritingError) -> HTTPException:
    return HTTPException(status_code=e.status_code, detail=e.message)


# ── 文件上传 ──────────────────────────────────────────────────────────────


@router.post("/upload")
async def upload_writing_file(file: UploadFile = File(...)):
    _upload_dir().mkdir(parents=True, exist_ok=True)
    ext = Path(file.filename or "file").suffix or ""
    safe_name = f"{uuid.uuid4().hex}{ext}"
    dest = _upload_dir() / safe_name
    with dest.open("wb") as f:
        shutil.copyfileobj(file.file, f)
    return {"success": True, "filename": file.filename, "path": str(dest), "size": dest.stat().st_size}


@router.get("/files/{file_name}")
async def serve_uploaded_file(file_name: str):
    """提供已上传文件的访问（图片等）。"""
    from fastapi.responses import FileResponse
    file_path = _upload_dir() / file_name
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="文件不存在")
    return FileResponse(path=str(file_path))


# ── 草稿 CRUD ────────────────────────────────────────────────────────────


@router.post("/drafts", response_model=DraftResponse)
async def create_draft(req: DraftCreateRequest, request: Request):
    store = get_writing_store(request)
    draft = await store.create(project_name=req.project_name, doc_type=req.doc_type, mode=req.mode)
    if req.model_name:
        draft = await store.update(draft["id"], project_name=draft.get("project_name"), model_name=req.model_name) or draft
    if req.kb_collection_id:
        draft = await store.update(draft["id"], kb_collection_id=req.kb_collection_id) or draft
    try:
        title = await svc_generate_title(req.project_name or "", req.doc_type or "report", model_name=req.model_name)
        if title:
            draft = await store.update(draft["id"], project_name=title) or draft
    except Exception:
        logger.warning("标题生成失败，使用原始名称")
    return DraftResponse(draft=draft, success=True)


@router.get("/drafts", response_model=DraftListResponse)
async def list_drafts(request: Request, limit: int = 50, offset: int = 0):
    store = get_writing_store(request)
    drafts = await store.list_drafts(limit=limit, offset=offset)
    return DraftListResponse(drafts=drafts, success=True)


@router.get("/drafts/{draft_id}", response_model=DraftResponse)
async def get_draft(draft_id: int, request: Request):
    store = get_writing_store(request)
    draft = await store.get(draft_id)
    if draft is None:
        raise HTTPException(status_code=404, detail="草稿不存在")
    return DraftResponse(draft=draft, success=True)


@router.put("/drafts/{draft_id}", response_model=DraftResponse)
async def update_draft(draft_id: int, req: DraftUpdateRequest, request: Request):
    store = get_writing_store(request)
    draft = await store.update(
        draft_id,
        project_name=req.project_name, doc_type=req.doc_type, mode=req.mode,
        stage=req.stage, files=req.files, chapters=req.chapters,
        word_count_min=req.word_count_min, word_count_max=req.word_count_max,
        demand_input=req.demand_input, finished=req.finished,
        generation_state=req.generation_state,
        model_name=req.model_name,
        kb_collection_id=req.kb_collection_id,
    )
    if draft is None:
        raise HTTPException(status_code=404, detail="草稿不存在")
    return DraftResponse(draft=draft, success=True)


@router.delete("/drafts/{draft_id}", response_model=DraftDeleteResponse)
async def delete_draft(draft_id: int, request: Request):
    store = get_writing_store(request)
    ok = await store.delete(draft_id)
    if not ok:
        raise HTTPException(status_code=404, detail="草稿不存在")
    return DraftDeleteResponse(success=True)


# ── 后台续生（SSE）──────────────────────────────────────────────────────


_resume_tasks: dict[int, asyncio.Task] = {}
_stream_queues: dict[int, asyncio.Queue] = {}


async def _background_generate(draft_id: int, store: WritingStore, queue: asyncio.Queue | None = None):
    """后台逐章生成，每完成一章写入 DB 并推送 SSE。

    KB 上下文在进入循环前一次性预取，LLM 无工具权限接触知识库。
    """
    # ── KB 上下文预取（生成前一次性完成） ────────────────────────
    kb_contexts: dict[int, str] = {}
    draft = await store.get(draft_id)
    if draft:
        kb_collection_id = draft.get("kb_collection_id") or ""
        if kb_collection_id:
            try:
                from deerflow.knowledge_base.service import KnowledgeBaseService
                from deerflow.persistence.engine import get_session_factory
                from deerflow.config import get_app_config
                from deerflow.models.factory import create_chat_model

                # 初始化 KB 服务（轻量级，用于匹配阶段的 LLM 调用）
                sf = get_session_factory()
                config = get_app_config()
                model = None
                kb_model_name = draft.get("model_name", "")
                if kb_model_name:
                    try:
                        model = create_chat_model(kb_model_name, app_config=config)
                    except Exception:
                        pass
                kb_service = KnowledgeBaseService(
                    session_factory=sf,
                    data_dir=getattr(config, "data_dir", "/app/backend/.deer-flow"),
                    model=model,
                )
                resolver = KBContextResolver(kb_service, model=model)
                kb_contexts = await resolver.resolve(
                    project_name=draft.get("project_name", ""),
                    chapters=draft.get("chapters", []),
                    collection_id=kb_collection_id,
                )
                logger.info(
                    "KB 上下文预取完成: %d 章有匹配",
                    len(kb_contexts),
                )
            except Exception as e:
                logger.warning("KB 上下文预取失败（不影响生成）: %s", e)
                kb_contexts = {}

    try:
        while True:
            draft = await store.get(draft_id)
            if draft is None:
                if queue: await queue.put({"type": "error", "message": "草稿不存在"})
                return
            gs = draft.get("generation_state", {})
            pending = gs.get("pending_chapters", [])
            if not pending:
                await store.update(draft_id, generation_state={**gs, "status": "completed"})
                if queue: await queue.put({"type": "completed"})
                return

            idx = pending[0]
            chapters = draft.get("chapters", [])
            if idx >= len(chapters):
                await store.update(draft_id, generation_state={**gs, "pending_chapters": pending[1:], "failed_chapters": gs.get("failed_chapters", []) + [idx]})
                continue

            # 防御性检查：跳过已有真实内容的章节（重启恢复场景，防止重复生成覆盖已有内容）
            # 注意：占位符/空内容不跳过，允许重新生成
            existing_content = chapters[idx].get("content", "")
            if existing_content and not _is_placeholder_content(existing_content):
                logger.info("跳过已有真实内容的章节 idx=%d title=%s（重启恢复场景）", idx, chapters[idx].get("title"))
                new_pending = pending[1:]
                new_generated = gs.get("generated_chapters", []) + [idx]
                await store.update(draft_id, generation_state={
                    **gs, "status": "generating", "pending_chapters": new_pending,
                    "generated_chapters": new_generated,
                    "failed_chapters": gs.get("failed_chapters", []),
                })
                continue

            chapter = chapters[idx]
            generation_error = ""
            try:
                html = await background_generate_chapter(
                    chapter, draft.get("project_name", ""), draft.get("doc_type", "report"),
                    files=draft.get("files"),
                    model_name=draft.get("model_name", ""),
                    kb_context=kb_contexts.get(idx, ""),
                )
                # 检查是否为占位符内容（LLM 返回空时的 fallback）
                if not html or "本节内容待撰写" in html or "待撰写" in html:
                    generation_error = "LLM 返回空内容，已使用占位符"
                    logger.warning("草稿 %d 第 %d 章 '%s' 内容为占位符", draft_id, idx, chapter.get("title"))
            except Exception as e:
                logger.exception(f"草稿 {draft_id} 第 {idx} 章生成异常")
                generation_error = str(e)
                html = f"<p>生成失败：{e}</p>"

            chapter["content"] = html
            chapters[idx] = chapter
            # 用 deepcopy 确保 SQLAlchemy 检测到变更
            chapters_copy = copy.deepcopy(chapters)
            new_pending = pending[1:]
            new_generated = gs.get("generated_chapters", []) + [idx]
            if generation_error:
                new_failed = gs.get("failed_chapters", []) + [idx]
            else:
                new_failed = gs.get("failed_chapters", [])
            logger.info("保存章节 idx=%d title=%s content_len=%d err=%s", idx, chapter.get("title"), len(html), generation_error or "无")
            await store.update(draft_id, chapters=chapters_copy, generation_state={
                **gs, "status": "generating", "pending_chapters": new_pending,
                "generated_chapters": new_generated, "failed_chapters": new_failed,
                "last_error": generation_error,
            })
            if queue:
                await queue.put({"type": "chapter", "index": idx, "content": chapter.get("content", ""), "error": generation_error})

    except asyncio.CancelledError:
        draft = await store.get(draft_id)
        if draft:
            gs = draft.get("generation_state", {})
            await store.update(draft_id, generation_state={**gs, "status": "interrupted"})
        if queue: await queue.put({"type": "interrupted"})
    except Exception:
        logger.exception(f"后台续生异常 草稿 {draft_id}")
        draft = await store.get(draft_id)
        if draft:
            gs = draft.get("generation_state", {})
            await store.update(draft_id, generation_state={**gs, "status": "interrupted", "last_error": "后台生成异常"})
        if queue: await queue.put({"type": "error", "message": "生成异常"})
    finally:
        # 后台任务自然结束后清理引用，让后续 SSE 连接重新创建
        _resume_tasks.pop(draft_id, None)
        _stream_queues.pop(draft_id, None)


@router.get("/drafts/{draft_id}/stream")
async def stream_generation(draft_id: int, request: Request):
    store = get_writing_store(request)
    draft = await store.get(draft_id)
    if draft is None:
        raise HTTPException(status_code=404, detail="草稿不存在")

    # 复用已有队列和任务（允许多个 SSE 连接共享同一个后台任务）
    queue = _stream_queues.get(draft_id)
    if queue is None:
        queue = asyncio.Queue()
        _stream_queues[draft_id] = queue

    existing = _resume_tasks.get(draft_id)
    if existing is None or existing.done():
        gs = draft.get("generation_state", {})
        pending = gs.get("pending_chapters", []) or [
            i for i, ch in enumerate(draft.get("chapters", [])) if not ch.get("content", "").strip()
        ]
        # 重启恢复场景：过滤掉已有真实内容的章节，防止重复生成覆盖已有内容
        # 占位符/空内容不跳过，允许重新生成
        chapters_list = draft.get("chapters", [])
        if pending and chapters_list:
            pending = [i for i in pending if i < len(chapters_list) and _is_placeholder_content(chapters_list[i].get("content", ""))]
        if pending:
            await store.update(draft_id, generation_state={
                "status": "generating", "pending_chapters": pending,
                "failed_chapters": gs.get("failed_chapters", []),
                "generated_chapters": gs.get("generated_chapters", []), "last_error": "",
            })
            task = asyncio.create_task(_background_generate(draft_id, store, queue))
            _resume_tasks[draft_id] = task
        else:
            await queue.put({"type": "completed"})

    async def event_generator():
        try:
            while True:
                event = await queue.get()
                yield f"event: {event['type']}\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"
                if event["type"] in ("completed", "error", "interrupted"):
                    break
        finally:
            # 保留 _resume_tasks 和 _stream_queues，防止重连时重复创建任务
            pass  # 队列和任务引用由后台任务完成时自行清理

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.get("/drafts/debug/latest")
async def debug_latest_draft(request: Request):
    """调试：返回最新草稿的章节内容摘要（无认证要求）。"""
    store = get_writing_store(request)
    # 从 store 内部获取最新草稿
    if hasattr(store, '_drafts'):
        drafts_dict = store._drafts
        if drafts_dict:
            latest_id = max(drafts_dict.keys())
            draft = drafts_dict[latest_id]
            chapters = draft.get("chapters", [])
            result = []
            for i, ch in enumerate(chapters):
                content = ch.get("content", "")
                result.append({
                    "index": i,
                    "title": ch.get("title", "?"),
                    "len": len(content),
                    "preview": content[:200].replace("\n", " ") if content else "(EMPTY)",
                })
            return {"draft_id": latest_id, "project_name": draft.get("project_name"), "chapters": result}
    return {"error": "no drafts"}


@router.get("/drafts/{draft_id}/status", response_model=StatusResponse)
async def get_generation_status(draft_id: int, request: Request):
    store = get_writing_store(request)
    draft = await store.get(draft_id)
    if draft is None:
        raise HTTPException(status_code=404, detail="草稿不存在")
    return StatusResponse(
        generation_state=draft.get("generation_state", {}),
        chapters=draft.get("chapters", []), success=True,
    )
