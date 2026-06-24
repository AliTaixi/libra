"""AI 内容生成 API — 薄路由层，逻辑在 deerflow.writing.service。"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from .models import (
    GenerateContentRequest, GenerateContentResponse,
    ReviseContentRequest, ReviseContentResponse,
    BatchGenerateContentRequest, BatchGenerateContentResponse,
    GenerateOutlineRequest, GenerateOutlineResponse,
)
from deerflow.writing.service import (
    WritingError,
    generate_content as svc_generate_content,
    revise_content as svc_revise_content,
    batch_generate_content as svc_batch_generate,
    get_outline,
)

router = APIRouter()


def _ok(e: WritingError) -> HTTPException:
    return HTTPException(status_code=e.status_code, detail=e.message)
    """将前端传入的模型配置名转为实际的 API 模型名。
    
    例如: "gemma4-31b" → "gemma4:31b"
    如果找不到配置，直接返回原值。
    """
    if not model_name:
        return ""
    app_config = get_app_config()
    model_config = app_config.get_model_config(model_name)
    if model_config and model_config.model:
        return model_config.model
    return model_name


@router.post("/generate-content", response_model=GenerateContentResponse)
async def generate_content(req: GenerateContentRequest):
    content = await svc_generate_content(
        req.chapter_title, req.project_name, req.doc_type,
        context=req.context, structure=[s.model_dump() for s in req.structure] if req.structure else None,
        chapter_description=req.chapter_description,
        model_name=req.model_name,
    )
    return GenerateContentResponse(content=content, success=True)


@router.post("/revise-content", response_model=ReviseContentResponse)
async def revise_content(req: ReviseContentRequest):
    content = await svc_revise_content(
        req.original_content, req.demand,
        chapter_title=req.chapter_title,
        word_count_min=req.word_count_min, word_count_max=req.word_count_max,
        model_name=req.model_name,
    )
    if not content:
        return ReviseContentResponse(content="", success=False)
    return ReviseContentResponse(content=content, success=True)


@router.post("/batch-generate-content", response_model=BatchGenerateContentResponse)
async def batch_generate_content(req: BatchGenerateContentRequest):
    if not req.chapters:
        return BatchGenerateContentResponse(contents=[], success=True)
    chapters_dict = [c.model_dump() for c in req.chapters]
    project = req.chapters[0].project_name or ""
    doc_type = req.chapters[0].doc_type or "report"
    results = await svc_batch_generate(chapters_dict, project, doc_type, model_name=req.model_name)
    return BatchGenerateContentResponse(
        contents=[GenerateContentResponse(**r) for r in results],
        success=True,
    )


@router.post("/generate-outline", response_model=GenerateOutlineResponse)
async def generate_outline(req: GenerateOutlineRequest):
    try:
        chapters = await get_outline(
            req.doc_type,
            project_name=req.project_name,
            description=req.description,
            existing_structure=req.existing_structure,
            model_name=req.model_name,
        )
        return GenerateOutlineResponse(chapters=chapters, success=True)
    except WritingError as e:
        raise _ok(e)
