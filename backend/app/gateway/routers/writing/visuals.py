"""图表/框架图/AI可视化 API — 薄路由层，逻辑在 deerflow.writing.service。"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from .models import (
    ChartGenerateRequest, ChartGenerateResponse,
    DiagramGenerateRequest, DiagramGenerateResponse,
    ChartFromTextRequest, DiagramFromTextRequest,
    ExtractChartDataRequest, ExtractChartDataResponse,
    ExtractDiagramCodeRequest, ExtractDiagramCodeResponse,
    AiGenerateVisualRequest, AiGenerateVisualResponse,
    GenerateTableRequest, GenerateTableResponse,
)
from deerflow.writing.service import (
    WritingError,
    generate_chart as svc_generate_chart,
    generate_diagram as svc_generate_diagram,
    chart_from_text, diagram_from_text,
    extract_chart_data as svc_extract_chart_data,
    extract_diagram_code as svc_extract_diagram_code,
    ai_generate_visual as svc_ai_generate_visual,
    generate_table_from_text as svc_generate_table_from_text,
)

router = APIRouter()
logger = logging.getLogger("app.gateway.routers.writing")


def _to_http(e: WritingError) -> HTTPException:
    return HTTPException(status_code=e.status_code, detail=e.message)


# ── 旧端点（接收结构化数据）──────────────────────────────────────────


@router.post("/generate-chart", response_model=ChartGenerateResponse)
async def generate_chart(req: ChartGenerateRequest):
    try:
        svg = await svc_generate_chart(req.data, req.chart_type, x=req.x, y=req.y,
                                        title=req.title, xlabel=req.xlabel, ylabel=req.ylabel)
        return ChartGenerateResponse(svg_content=svg, success=True)
    except WritingError as e:
        raise _to_http(e)


@router.post("/generate-diagram", response_model=DiagramGenerateResponse)
async def generate_diagram(req: DiagramGenerateRequest):
    try:
        svg = await svc_generate_diagram(req.mermaid_code)
        return DiagramGenerateResponse(svg_content=svg, success=True)
    except WritingError as e:
        raise _to_http(e)


# ── 新端点（从原文直接生成）────────────────────────────────────────


@router.post("/generate-chart-from-text", response_model=ChartGenerateResponse)
async def generate_chart_from_text_route(req: ChartFromTextRequest):
    try:
        svg = await chart_from_text(req.text, req.chart_type, title=req.title or "")
        return ChartGenerateResponse(svg_content=svg, success=True)
    except WritingError as e:
        raise _to_http(e)


@router.post("/generate-diagram-from-text", response_model=DiagramGenerateResponse)
async def generate_diagram_from_text_route(req: DiagramFromTextRequest):
    try:
        svg = await diagram_from_text(req.text, req.diagram_type)
        return DiagramGenerateResponse(svg_content=svg, success=True)
    except WritingError as e:
        raise _to_http(e)


# ── 旧数据提取端点 ──────────────────────────────────────────────────


@router.post("/extract-chart-data", response_model=ExtractChartDataResponse)
async def extract_chart_data_route(req: ExtractChartDataRequest):
    result = await svc_extract_chart_data(req.text, req.chart_type)
    return ExtractChartDataResponse(
        data=result.get("data", []), x=result.get("x", ""), y=result.get("y", ""),
        title=result.get("title", ""), xlabel=result.get("xlabel", ""),
        ylabel=result.get("ylabel", ""), success=result.get("success", False),
    )


@router.post("/extract-diagram-code", response_model=ExtractDiagramCodeResponse)
async def extract_diagram_code_route(req: ExtractDiagramCodeRequest):
    result = await svc_extract_diagram_code(req.text, req.diagram_type)
    return ExtractDiagramCodeResponse(
        mermaid_code=result.get("mermaid_code", ""),
        success=result.get("success", False),
    )


# ── AI 智能可视化 ────────────────────────────────────────────────────


@router.post("/ai-generate-visual", response_model=AiGenerateVisualResponse)
async def ai_generate_visual_route(req: AiGenerateVisualRequest):
    result = await svc_ai_generate_visual(req.text)
    return AiGenerateVisualResponse(
        content=result.get("content", ""),
        content_type=result.get("content_type", "html"),
        caption=result.get("caption", ""),
        success=result.get("success", False),
    )


# ── AI 智能表格生成 ──────────────────────────────────────────────────


@router.post("/generate-table-from-text", response_model=GenerateTableResponse)
async def generate_table_from_text_route(req: GenerateTableRequest):
    result = await svc_generate_table_from_text(req.text, model_name=req.model_name)
    return GenerateTableResponse(
        table_html=result.get("table_html", ""),
        caption=result.get("caption", ""),
        success=result.get("success", False),
    )
