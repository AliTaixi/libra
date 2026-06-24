"""draw.io AI 生成 API Router。

提供 LLM 驱动的 draw.io 图表生成接口。
"""

from __future__ import annotations

import logging
import re

from pydantic import BaseModel, Field

from fastapi import APIRouter

from app.gateway.authz import require_permission
from deerflow.writing.service import call_llm, WritingError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/drawio", tags=["drawio"])


class AIGenerateRequest(BaseModel):
    """AI 生成 draw.io 图表请求。"""
    prompt: str = Field(..., description="用户描述", min_length=1)
    current_xml: str | None = Field(default=None, description="当前图表 XML（修改模式）")
    model_name: str = Field(default="", description="模型名称")


class AIGenerateResponse(BaseModel):
    """AI 生成 draw.io 图表响应。"""
    xml: str = Field(default="", description="生成的 draw.io XML")
    raw_content: str = Field(default="", description="原始 LLM 响应")
    success: bool = Field(default=True)
    error: str = Field(default="", description="失败原因")


DRAWIO_SYSTEM_PROMPT = """你是一个专业图表生成助手。请根据用户描述生成 draw.io 原生 XML 格式的图表。

要求：
- 输出必须是有效的 draw.io XML（mxGraphModel 格式）
- 使用干净的专业配色（蓝色主色调，灰色辅助色）
- 文字使用中文
- 合理布局，避免元素重叠
- 只输出 XML，不要额外的解释

⚠️ 强制要求：每个具有 vertex="1" 或 edge="1" 的 mxCell 元素上方，都必须有一行中文注释（<!-- ... -->），用中文简要说明该图形/连线的作用。不允许遗漏任何图形元素的注释。

XML 格式示例（带注释）：
<mxGraphModel>
  <root>
    <mxCell id="0" />
    <mxCell id="1" parent="0" />
    <!-- 流程开始节点 -->
    <mxCell id="2" value="开始" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1">
      <mxGeometry x="40" y="40" width="120" height="40" as="geometry" />
    </mxCell>
    <!-- 流程结束节点 -->
    <mxCell id="3" value="结束" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1">
      <mxGeometry x="40" y="160" width="120" height="40" as="geometry" />
    </mxCell>
  </root>
</mxGraphModel>"""


COMMENT_PROMPT = """你是一个 XML 注释助手。你的任务是为 draw.io 图表的 XML 中的每个图形元素添加中文注释。

要求：
- 只给带有 vertex="1" 或 edge="1" 的 mxCell 加注释
- 每个元素上方加一行 <!-- 中文注释 -->，用中文简要说明该元素的作用
- 不要修改任何 XML 结构、属性或内容
- 只输出修改后的完整 XML，不要额外的解释
- 已经有的注释不要重复加

示例：
修改前：
<mxCell id="2" value="用户登录" style="rounded=1;" vertex="1" parent="1">
  <mxGeometry x="40" y="40" width="120" height="40" as="geometry" />
</mxCell>

修改后：
<!-- 用户登录节点 -->
<mxCell id="2" value="用户登录" style="rounded=1;" vertex="1" parent="1">
  <mxGeometry x="40" y="40" width="120" height="40" as="geometry" />
</mxCell>"""


def _needs_comments(xml: str) -> bool:
    """检查是否有 vertex/edge 元素缺少注释。"""
    # 找所有没有前导注释的 vertex/edge mxCell
    pattern = re.compile(
        r"(?:<!--\s*[^>]*?\s*-->)?\s*"
        r"(<mxCell\s[^>]*?(?:vertex|edge)\s*?=\s*?\"1\"[^>]*?>)",
    )
    for match in pattern.finditer(xml):
        if not match.group(1):  # 没有前导注释
            # 检查前一行是否有注释
            pos = match.start()
            before = xml[max(0, pos - 100):pos]
            if "<!--" not in before:
                return True
    return False


@router.post("/generate", response_model=AIGenerateResponse)
@require_permission("threads", "read")
async def generate_diagram(req: AIGenerateRequest) -> AIGenerateResponse:
    """根据自然语言描述生成 draw.io 图表 XML。"""
    try:
        user_prompt = req.prompt
        if req.current_xml:
            user_prompt += (
                f"\n\n需要对以下图表进行修改"
                f"（保留原有结构，只修改用户要求的部分）：\n{req.current_xml}"
            )

        raw = await call_llm(DRAWIO_SYSTEM_PROMPT, user_prompt, model_name=req.model_name)
        xml = _extract_drawio_xml(raw)

        # 第二轮：检查注释是否齐全，不齐就调 LLM 专门补注释
        if xml and _needs_comments(xml):
            try:
                commented = await call_llm(
                    COMMENT_PROMPT,
                    f"请为以下 XML 中缺少注释的图形元素添加中文注释：\n\n{xml}",
                    model_name=req.model_name,
                )
                commented_xml = _extract_drawio_xml(commented)
                if commented_xml and len(commented_xml) > 50:
                    xml = commented_xml
                    logger.info("Comments added via LLM for %s", req.prompt[:50])
            except Exception:
                logger.warning("Comment LLM failed, using original XML")

        return AIGenerateResponse(
            xml=xml,
            raw_content=raw,
            success=True,
        )
    except WritingError as e:
        return AIGenerateResponse(
            success=False,
            error=e.message,
        )
    except Exception as e:
        logger.exception("draw.io 图表生成失败")
        return AIGenerateResponse(
            success=False,
            error=str(e),
        )


def _extract_drawio_xml(text: str) -> str:
    """从 LLM 响应中提取 draw.io XML。"""
    # 提取 ```xml ... ``` 中的内容
    xml_block_match = re.search(r"```(?:xml)?\s*([\s\S]*?)```", text)
    if xml_block_match:
        extracted = xml_block_match.group(1).strip()
        if extracted.startswith("<mxGraphModel") or extracted.startswith("<?xml"):
            return extracted

    # 尝试直接匹配 mxGraphModel
    mx_match = re.search(r"<mxGraphModel[\s\S]*?<\/mxGraphModel>", text)
    if mx_match:
        return mx_match.group(0)

    return text
