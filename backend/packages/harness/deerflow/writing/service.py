"""WritingService — 全文写作核心业务逻辑。

所有功能以独立函数提供，不依赖 FastAPI。
HTTP 层面的请求解析/响应格式化由 routers/writing/ 处理。
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import subprocess
import uuid
from pathlib import Path

from deerflow.runtime.user_context import get_effective_user_id

logger = logging.getLogger("deerflow.writing")

# ── 异常 ──────────────────────────────────────────────────────────────────


class WritingError(Exception):
    """写作业务异常，由调用方（route / agent tool）转为适当响应格式。"""
    def __init__(self, message: str, code: str = "writing_error", status_code: int = 422):
        self.message = message
        self.code = code
        self.status_code = status_code
        super().__init__(message)


class ServiceUnavailableError(WritingError):
    def __init__(self, message: str):
        super().__init__(message, code="service_unavailable", status_code=502)


class NotFoundError(WritingError):
    def __init__(self, message: str):
        super().__init__(message, code="not_found", status_code=404)


# ── 路径常量 ──────────────────────────────────────────────────────────────

DEER_FLOW_HOME = Path(os.environ.get("DEER_FLOW_HOME", "/app/backend/.deer-flow"))
SKILLS_DIR = Path("/app/skills/public")
CHART_SCRIPT = SKILLS_DIR / "chart-code-generation" / "scripts" / "generate.py"
DIAGRAM_SCRIPT = SKILLS_DIR / "diagram-code-generation" / "scripts" / "render.sh"


def _user_data_dir() -> Path:
    return DEER_FLOW_HOME / "users" / get_effective_user_id() / "user-data"


def _upload_dir() -> Path:
    return _user_data_dir()


def _ensure_output_dir():
    _user_data_dir().mkdir(parents=True, exist_ok=True)


def _read_file(path: Path) -> str:
    if not path.exists():
        raise NotFoundError(f"文件不存在: {path}")
    return path.read_text(encoding="utf-8")


def _validate_svg(content: str) -> None:
    trimmed = content.strip()
    if not (trimmed.startswith("<svg") or trimmed.startswith("<?xml") or "<svg " in trimmed[:200]):
        snippet = trimmed[:100].replace("\n", " ").strip()
        raise ServiceUnavailableError(f"渲染结果不是有效 SVG ({snippet[:60]}...)")


# ── LLM 调用 ──────────────────────────────────────────────────────────────

_OLLAMA_BASE_URL: str | None = None


def _get_ollama_base_url() -> str:
    global _OLLAMA_BASE_URL
    if _OLLAMA_BASE_URL is None:
        _OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://host.docker.internal:11434").rstrip("/")
    return _OLLAMA_BASE_URL


async def call_llm(system_prompt: str, user_prompt: str, seed: int | None = None, model_name: str = "") -> str:
    """调用 LLM（OpenAI 兼容），返回响应文本。"""
    import urllib.request

    base_url = _get_ollama_base_url()
    api_key = os.environ.get("OLLAMA_API_KEY", "")

    # 解析模型名：配置名 → 实际 API 模型名（例如 "gemma4-local" → "gemma4:31b-cloud"）
    resolved_model = model_name
    try:
        from deerflow.config.app_config import get_app_config
        app_config = get_app_config()
        if model_name:
            model_config = app_config.get_model_config(model_name)
            if model_config and model_config.model:
                resolved_model = model_config.model
        # 没传或解析失败时用第一个可用模型（兼容旧草稿）
        if not resolved_model and app_config.models:
            resolved_model = app_config.models[0].model
    except Exception:
        pass

    if not resolved_model:
        raise WritingError("请先在设置中添加一个模型")

    payload: dict = {
        "model": resolved_model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.7,
        "max_tokens": 8192,
        "stream": False,
    }
    if seed is not None:
        payload["seed"] = seed

    body = json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    req = urllib.request.Request(
        f"{base_url}/v1/chat/completions",
        data=body,
        headers=headers,
        method="POST",
    )

    def _sync_call() -> str:
        max_retries = 8
        last_error = ""
        for attempt in range(max_retries):
            try:
                with urllib.request.urlopen(req, timeout=600) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                    content = data["choices"][0]["message"]["content"]
                    if content and content.strip():
                        return content
                    # LLM 返回了空或纯空白内容，视为一次失败
                    last_error = f"LLM 返回了空内容 (attempt {attempt+1})"
                    logger.warning(last_error)
            except Exception as e:
                last_error = str(e)
                is_last = attempt >= max_retries - 1
                if is_last:
                    logger.error(f"LLM 调用失败 (已重试{max_retries}次): {last_error}")
                    return ""
                wait = 5 * (attempt + 1)
                logger.warning(f"LLM 调用失败 (第{attempt+1}次)，{wait}s 后重试: {last_error}")
                import time
                time.sleep(wait)
        return ""

    return await asyncio.to_thread(_sync_call)


def _clean_llm_json(raw: str) -> str:
    """去掉 LLM 返回中的 markdown 代码块标记。"""
    clean = raw.strip()
    if clean.startswith("```"):
        clean = clean.split("\n", 1)[-1]
        if "```" in clean:
            clean = clean.rsplit("```", 1)[0]
    return clean.strip()


# ── Markdown ↔ HTML ──────────────────────────────────────────────────────


def _is_table_separator(line: str) -> bool:
    stripped = line.strip("|").strip()
    return bool(re.match(r"^[:\-\s]+$", stripped))


def _md_inline_to_html(text: str) -> str:
    text = re.sub(r"`([^`]+)`", r"<code>\1</code>", text)
    text = re.sub(r"~~(.+?)~~", r"<s>\1</s>", text)
    text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)", r"<em>\1</em>", text)
    text = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2">\1</a>', text)
    text = re.sub(r"!\[([^\]]*)\]\(([^)]+)\)", r'<img src="\2" alt="\1" />', text)
    return text


def md_to_html(text: str) -> str:
    lines = text.split("\n")
    html_lines: list[str] = []
    for raw_line in lines:
        line = raw_line.strip()
        if not line:
            continue  # 跳过空行，避免 Slate 解析出空文本节点
        pipe_count = line.count("|")
        is_table_row = (line.startswith("|") and line.endswith("|")) or pipe_count >= 2
        if is_table_row:
            if _is_table_separator(line):
                continue
            cells = [c.strip() for c in line.split("|") if c.strip()]
            if cells:
                html_lines.append(f"<p>{_md_inline_to_html(' | '.join(cells))}</p>")
            continue
        list_match = re.match(r"^(\s*)([-*]|\d+\.)\s+(.*)", line)
        if list_match:
            html_lines.append(f"<li>{_md_inline_to_html(list_match.group(3))}</li>")
            continue
        heading_match = re.match(r"^(#{1,4})\s+(.*)", line)
        if heading_match:
            html_lines.append(f"<h{len(heading_match.group(1))}>{_md_inline_to_html(heading_match.group(2))}</h{len(heading_match.group(1))}>")
            continue
        html_lines.append(f"<p>{_md_inline_to_html(line)}</p>")
    result = "\n".join(html_lines)
    # 移除残留的空段落，防止 Slate 解析出空文本节点
    result = re.sub(r'<p>\s*</p>', '', result)
    return result


# ══════════════════════════════════════════════════════════════════════════
# 图表生成
# ══════════════════════════════════════════════════════════════════════════

CHART_TYPE_NAMES = {
    "bar": "柱状图", "line": "折线图", "pie": "饼图",
    "scatter": "散点图", "box": "箱线图", "violin": "小提琴图", "heatmap": "热力图",
}


def _chart_tool(chart_type: str) -> str:
    return "2" if chart_type in ("heatmap", "box", "violin") else "1"


async def generate_chart(data_args: list[str], chart_type: str, *,
                          x: str = "", y: str = "",
                          title: str = "", xlabel: str = "", ylabel: str = "") -> str:
    """调用 chart-code-generation skill 生成 SVG。返回 SVG 字符串。"""
    _ensure_output_dir()
    out_path = _user_data_dir() / f"chart_{uuid.uuid4().hex}.svg"
    cmd = ["python3", str(CHART_SCRIPT),
           "--tool", _chart_tool(chart_type),
           "--type", chart_type,
           "--output", str(out_path)]
    for d in data_args:
        cmd.extend(["--data", d])
    if x: cmd.extend(["--x", x])
    if y: cmd.extend(["--y", y])
    if title: cmd.extend(["--title", title])
    if xlabel: cmd.extend(["--xlabel", xlabel])
    if ylabel: cmd.extend(["--ylabel", ylabel])
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        if proc.returncode != 0:
            raise WritingError(f"图表渲染失败: {proc.stderr}")
        svg = _read_file(out_path)
        _validate_svg(svg)
        return svg
    except subprocess.TimeoutExpired:
        raise WritingError("图表渲染超时", status_code=504)
    finally:
        out_path.unlink(missing_ok=True)


async def generate_diagram(mermaid_code: str) -> str:
    """调用 diagram-code-generation skill 渲染 Mermaid → base64 PNG data URI。

    和 diagram-code-generation skill 使用完全相同的渲染路径（PNG 模式），
    避免 SVG 模式下 inlineStyles 函数导致文字布局异常。
    """
    import base64
    _ensure_output_dir()
    # 规范化 Mermaid 代码：大多数图类型不支持分号分隔语句，必须用换行符
    normalized = mermaid_code.replace(";", "\n")
    while "\n\n\n" in normalized:
        normalized = normalized.replace("\n\n\n", "\n\n")
    out_path = _user_data_dir() / f"diagram_{uuid.uuid4().hex}.png"
    mmd_file = _user_data_dir() / f"diagram_{uuid.uuid4().hex}.mmd"
    mmd_file.write_text(normalized, encoding="utf-8")
    try:
        proc = subprocess.run(
            ["bash", str(DIAGRAM_SCRIPT), str(mmd_file), str(out_path), "png"],
            capture_output=True, text=True, timeout=30,
        )
        if proc.returncode != 0:
            detail = proc.stderr or ""
            if out_path.exists():
                try:
                    err_body = out_path.read_bytes()[:200]
                    if err_body:
                        detail += f" | {err_body}"
                except Exception:
                    pass
            raise WritingError(f"框架图渲染失败: {detail}", status_code=422)
        if not out_path.exists():
            raise WritingError("框架图渲染失败: 输出文件不存在")
        png_b64 = base64.b64encode(out_path.read_bytes()).decode()
        return f"data:image/png;base64,{png_b64}"
    except subprocess.TimeoutExpired:
        raise WritingError("框架图渲染超时", status_code=504)
    finally:
        mmd_file.unlink(missing_ok=True)
        out_path.unlink(missing_ok=True)


async def chart_from_text(text: str, chart_type: str, title: str = "", model_name: str | None = None) -> str:
    """原文 → AI 提取数据 → 生成图表 SVG。"""
    chart_name = CHART_TYPE_NAMES.get(chart_type, chart_type)
    prompt = f"""你是一个数据提取专家。用户选择生成{chart_name}，请从文字中提取结构化数据。

返回严格的 JSON（不要 markdown 代码块标记）：
{{"data": ["系列名:值1|值2|值3"], "x": "标签1|标签2|标签3", "y": "", "title": "图表标题", "xlabel": "", "ylabel": ""}}

规则：
- data 数组格式 "系列名称:数值1|数值2|数值3"
- x 为类别标签，用 | 分隔
- y 为 Y 轴行标签（仅热力图需要），用 | 分隔
- 如果无数值数据，data 返回空数组
- 严禁编造数据"""

    raw = await call_llm(prompt, f"图表类型：{chart_type}\n选中的文字：\n{text[:3000]}", model_name=model_name)
    if not raw:
        raise WritingError("AI 分析失败，无法提取数据")

    try:
        result = json.loads(_clean_llm_json(raw))
    except json.JSONDecodeError:
        raise WritingError("AI 未能提取有效数据")

    data = result.get("data", [])
    if not data or all(not d.strip() for d in data):
        raise WritingError("未识别出可生成图表的数值数据")

    return await generate_chart(
        data, chart_type,
        x=result.get("x", ""), y=result.get("y", ""),
        title=title or result.get("title", ""),
        xlabel=result.get("xlabel", ""), ylabel=result.get("ylabel", ""),
    )


async def diagram_from_text(text: str, diagram_type: str, model_name: str = "") -> str:
    """原文 → AI 生成 Mermaid → 渲染 SVG。"""
    prompt = f"""你是一个 Mermaid 图表生成专家。用户选择了 {diagram_type}，请根据文字生成 Mermaid 代码。

返回 JSON：{{"mermaid_code": "..."}}
规则：
1. mermaid_code 以 "{diagram_type}" 开头（不要加分号），每行一条语句
2. 纯文字节点名，不要 emoji

图类型特定规则：
- graph TD / sequenceDiagram：正常使用 --> 或 ->> 定义关系
- stateDiagram-v2：用 --> 定义状态转换，例如 [*] --> State1
- C4Context：必须用 Rel() 函数，绝不能使用 -->。正确写法：
  C4Context
  Person(u, "用户")
  System(s, "系统")
  System_Ext(e, "外部系统")
  Rel(u, s, "使用")
  Rel(s, e, "调用")
- erDiagram：用 ||--o{{ 等符号，不要用 -->
- mindmap：用缩进表示层级"""

    raw = await call_llm(prompt, f"图类型：{diagram_type}\n{text[:3000]}", model_name=model_name)
    if not raw:
        raise WritingError("AI 分析失败，无法生成 Mermaid 代码")

    try:
        result = json.loads(_clean_llm_json(raw))
        mermaid_code = result.get("mermaid_code", "")
    except json.JSONDecodeError:
        raise WritingError("AI 未能生成有效 Mermaid 代码")

    if not mermaid_code:
        raise WritingError("AI 生成的 Mermaid 代码为空")

    return await generate_diagram(mermaid_code)


async def extract_chart_data(text: str, chart_type: str, model_name: str = "") -> dict:
    """提取图表结构化数据（供旧前端兼容）。"""
    chart_name = CHART_TYPE_NAMES.get(chart_type, chart_type)
    prompt = f"""你是一个数据提取专家。用户选择生成{chart_name}。

返回 JSON：{{"data":["系列名:值1|值2"],"x":"标签1|标签2","y":"","title":"","xlabel":"","ylabel":""}}
规则：无数据时 data 返回空数组，success=false。严禁编造。"""

    raw = await call_llm(prompt, f"{chart_type}\n{text[:2000]}", model_name=model_name)
    if not raw:
        return {"data": [], "success": False}
    try:
        result = json.loads(_clean_llm_json(raw))
        data = result.get("data", [])
        if not data or all(not d.strip() for d in data):
            return {"data": [], "success": False}
        return {
            "data": data, "x": result.get("x", ""), "y": result.get("y", ""),
            "title": result.get("title", ""), "xlabel": result.get("xlabel", ""),
            "ylabel": result.get("ylabel", ""), "success": True,
        }
    except json.JSONDecodeError:
        return {"data": [], "success": False}


async def extract_diagram_code(text: str, diagram_type: str, model_name: str = "") -> dict:
    """提取 Mermaid 代码（供旧前端兼容）。"""
    prompt = f"""你是一个 Mermaid 专家。用户选择了 {diagram_type}。

返回 JSON：{{"mermaid_code":"..."}}
规则：以 "{diagram_type}" 开头（不要加分号），每行一条语句，不要 emoji。"""

    raw = await call_llm(prompt, f"{diagram_type}\n{text[:2000]}", model_name=model_name)
    if not raw:
        return {"mermaid_code": "", "success": False}
    try:
        result = json.loads(_clean_llm_json(raw))
        code = result.get("mermaid_code", "")
        if code:
            return {"mermaid_code": code, "success": True}
    except json.JSONDecodeError:
        pass
    return {"mermaid_code": "", "success": False}


# ══════════════════════════════════════════════════════════════════════════
# AI 可视化（自动判断图表/框架图/表格）
# ══════════════════════════════════════════════════════════════════════════

async def ai_generate_visual(text: str, model_name: str = "") -> dict:
    """AI 分析文字 → 自动选最佳可视化方式 → 生成并返回。"""
    decision_prompt = """你是一个数据分析与可视化专家。分析文字，选最佳可视化类型。

可选：chart / diagram / table
返回 JSON（不要代码块）：
chart时: {"type":"chart","caption":"标题","config":{"tool":"1","chart_type":"bar","data":["值:1|2"],"x":"A|B","title":"","xlabel":"","ylabel":""}}
diagram时: {"type":"diagram","caption":"标题","config":{"mermaid_code":"graph TD; A-->B;"}}
table时: {"type":"table","caption":"标题","config":{"headers":["列1","列2"],"rows":[["v1","v2"]]}}"""

    raw = await call_llm(decision_prompt, f"{text[:3000]}", model_name=model_name)
    if not raw:
        return {"content": "", "content_type": "html", "caption": "AI 分析失败", "success": False}

    try:
        decision = json.loads(_clean_llm_json(raw))
    except json.JSONDecodeError:
        decision = {"type": "table", "caption": "数据表格", "config": {}}

    vtype = decision.get("type", "table")
    caption = decision.get("caption", "")
    config = decision.get("config", {})

    if vtype == "chart":
        try:
            svg = await generate_chart(
                config.get("data", []), config.get("chart_type", "bar"),
                x=config.get("x", ""), title=config.get("title", ""),
                xlabel=config.get("xlabel", ""), ylabel=config.get("ylabel", ""),
            )
            return {"content": svg, "content_type": "svg", "caption": caption, "success": True}
        except WritingError as e:
            return {"content": f"<p>{e.message}</p>", "content_type": "html", "caption": caption, "success": False}

    elif vtype == "diagram":
        mermaid_code = config.get("mermaid_code", "")
        if not mermaid_code:
            return {"content": "<p>AI 未生成有效 Mermaid 代码</p>", "content_type": "html", "caption": caption, "success": False}
        try:
            svg = await generate_diagram(mermaid_code)
            return {"content": svg, "content_type": "svg", "caption": caption, "success": True}
        except WritingError as e:
            return {"content": f"<p>{e.message}</p>", "content_type": "html", "caption": caption, "success": False}

    else:
        headers = config.get("headers", [])
        rows = config.get("rows", [])
        if not headers:
            lines = [l.strip() for l in text.split("\n") if l.strip()]
            if lines:
                headers = lines[0].split(",") if "," in lines[0] else lines[0].split("|")
                rows = [l.split("," if "," in l else "|") for l in lines[1:]]
        table_html = '<figure>\n<table class="generated-table" style="width:100%;border-collapse:collapse;">\n<thead>\n<tr>\n'
        for h in headers:
            table_html += f'<th style="border:1px solid #ccc;padding:6px 10px;background:#f5f5f5;">{h.strip()}</th>\n'
        table_html += '</tr>\n</thead>\n<tbody>\n'
        for row in rows:
            table_html += '<tr>\n'
            for cell in row:
                table_html += f'<td style="border:1px solid #ccc;padding:6px 10px;">{cell.strip()}</td>\n'
            table_html += '</tr>\n'
        table_html += '</tbody>\n</table>\n</figure>\n'
        return {"content": table_html, "content_type": "html", "caption": caption, "success": True}


# ══════════════════════════════════════════════════════════════════════════
# AI 表格生成
# ══════════════════════════════════════════════════════════════════════════


async def generate_table_from_text(text: str, model_name: str = "") -> dict:
    """AI 分析文字 → 提取结构化表格数据 → 返回 HTML 表格。

    支持任意不规则文本：描述性段落、清单、对比说明等，
    AI 自动分析出最适合的列数和行结构。
    """
    prompt = """你是一个数据分析与表格设计专家。分析用户选中的文字，提取或设计出最能呈现数据的表格结构。

返回 JSON 格式（不要代码块标记）：
{"headers": ["列1名", "列2名", ...], "rows": [["值1", "值2", ...], ...], "caption": "表格标题"}

规则：
1. headers 是表头数组，列数 2-6 列
2. rows 是数据行数组，每行与 headers 列数一致
3. 如果原文有明确结构化数据（如对比、清单、统计数据），提取为表格
4. 如果原文是不规则段落，分析其内容逻辑，自行设计表格结构
5. 表格标题要简洁概括表格内容
6. 所有数据用字符串表示，不要额外格式
7. 严禁编造数据——只使用原文中出现的信息"""

    raw = await call_llm(prompt, f"需要生成表格的文字：\n{text[:3000]}", model_name=model_name)
    if not raw:
        return {"table_html": "", "caption": "AI 分析失败", "success": False}

    try:
        result = json.loads(_clean_llm_json(raw))
    except json.JSONDecodeError:
        return {"table_html": "", "caption": "AI 未能生成有效表格", "success": False}

    headers = result.get("headers", [])
    rows = result.get("rows", [])
    caption = result.get("caption", "数据表格")

    if not headers or not rows:
        # 兜底：按行拆分做简单表格
        lines = [l.strip() for l in text.split("\n") if l.strip()]
        if len(lines) >= 2:
            sep = "," if "," in lines[0] else "|"
            headers = [h.strip() for h in lines[0].split(sep) if h.strip()]
            rows = [[c.strip() for c in l.split(sep) if c.strip()] for l in lines[1:]]
        else:
            return {"table_html": "", "caption": caption, "success": False}

    table_html = (
        '<figure>\n'
        '<table class="generated-table" style="width:100%;border-collapse:collapse;">\n'
        '<thead>\n<tr>\n'
    )
    for h in headers:
        table_html += f'<th style="border:1px solid #ccc;padding:6px 10px;background:#f5f5f5;">{h}</th>\n'
    table_html += '</tr>\n</thead>\n<tbody>\n'
    for row in rows:
        table_html += '<tr>\n'
        for cell in row:
            table_html += f'<td style="border:1px solid #ccc;padding:6px 10px;">{cell}</td>\n'
        table_html += '</tr>\n'
    table_html += '</tbody>\n</table>\n</figure>\n'

    return {"table_html": table_html, "caption": caption, "success": True}


# ══════════════════════════════════════════════════════════════════════════
# AI 内容生成
# ══════════════════════════════════════════════════════════════════════════

CONTENT_SYSTEM_PROMPT = """你是一个专业的技术文档写作助手。根据文档类型和章节结构，为每个标题下的正文区域撰写内容。

核心规则：
1. 禁止新增、删除、修改任何标题——只撰写标题下的正文
2. 每个标题下都必须生成内容，不得跳过
3. 使用专业、简洁、客观的语气
4. 每个标题下正文不低于500字
5. 使用 Markdown 格式：# 章标题  ## 节标题  ### 小节标题，不加多余编号
6. 禁止生成表格
7. 禁止在正文中出现行内代码（即反引号 `` ` `` 包裹的代码片段），允许使用独立成行的代码块（`` ``` `` 包裹，可单行）
8. 不需要解释，直接输出内容"""


async def generate_content(chapter_title: str, project_name: str, doc_type: str,
                           context: str = "", structure: list | None = None,
                           chapter_description: str = "",
                           model_name: str = "",
                           kb_context: str = "") -> str:
    """AI 为单个章节生成内容。

    Args:
        kb_context: 由 KBContextResolver 预取的知识库节点原文，
                    在 Python 层注入，LLM 无工具权限接触知识库。
    """
    structure_text = ""
    if structure:
        for item in structure:
            # item 是 L1（与 chapter_title 重复），直接从 L2 开始
            for child in item.get("children", []):
                structure_text += f"## {child.get('title', '')}\n"
                for grandchild in child.get("children", []):
                    structure_text += f"### {grandchild.get('title', '')}\n"

    lines = [f"# {chapter_title}"]
    if structure_text:
        for line in structure_text.strip().split("\n"):
            line = line.strip()
            if not line: continue
            lines.append(line)
    full_structure = "\n".join(lines)

    desc_info = f"\n章节说明：{chapter_description}" if chapter_description else ""

    # ── KB 知识库上下文（Python 层预取，LLM 无工具权限） ──
    kb_section = ""
    if kb_context:
        SEP = "─" * 50
        kb_section = f"""
参考以下知识库原文撰写本节内容（严格基于原文信息，可合理引申但不得编造）：
{SEP}
{kb_context}
{SEP}

"""

    user_prompt = f"""文档类型：{doc_type}
项目名称：{project_name}

章节标题（严格保留）：
{full_structure}
{desc_info}

{kb_section}{context[:2000] if context else ""}

为以上每个标题撰写正文，每节不低于500字。"""

    content = await call_llm(CONTENT_SYSTEM_PROMPT, user_prompt, model_name=model_name)
    if not content or not content.strip():
        logger.warning("generate_content: LLM 返回空，章节 '%s' 使用占位符", chapter_title)
        return f"【{chapter_title}】\n\n本节内容待撰写。"
    return content


async def revise_content(original_content: str, demand: str,
                         chapter_title: str = "",
                         word_count_min: int = 0, word_count_max: int = 0,
                         model_name: str = "") -> str:
    """AI 根据需求修改内容——智能体全文写作 Stage2 的核心修改功能。

    支持的修改场景（由 demand 参数驱动）：
    - 润色改写：优化表达、修正语病
    - 扩写/缩写：配合 word_count_min/max 控制篇幅
    - 重写：改变表述角度或风格
    - 格式化：调整段落结构、补充标题
    - 内容续写：在选中文字末尾继续撰写
    - 翻译：中译英 / 英译中
    - 专业适配：将内容转为更适合特定读者/场景的表达

    字数控制优先级（当 word_count_min/max 与 demand 冲突时，以 demand 为准）：
    - 都 > 0  ：严格控制在 [min, max] 范围内
    - min > 0  ：至少 min 字
    - max > 0  ：不超过 max 字
    - 都 = 0  ：不限制字数，按修改需求自然输出
    """
    # ── 构建字数约束指令 ──────────────────────────────────────────
    word_count_instruction = ""
    if word_count_min > 0 and word_count_max > 0:
        word_count_instruction = (
            f"- 字数控制：修改后的内容必须在 {word_count_min}-{word_count_max} 字之间。"
            f"如果原文字数不在该范围内，你需要通过{'扩充细节' if len(original_content) < word_count_min else '精简表达'}来达到要求。\n"
        )
    elif word_count_min > 0:
        word_count_instruction = (
            f"- 字数控制：修改后的内容不得少于 {word_count_min} 字。"
            f"如果原文字数不足，请补充相关技术细节、例证或解释性文字。\n"
        )
    elif word_count_max > 0:
        word_count_instruction = (
            f"- 字数控制：修改后的内容不得超过 {word_count_max} 字。"
            f"如果原文超长，请精简表达、合并重复内容。\n"
        )

    # ── 标题与正文分离 ──────────────────────────────────────────
    # 用脚本提取标题（#格式 + 编号格式），只把正文给 LLM，改完再拼回去
    def _detect_heading_level(line: str) -> int | None:
        """检测标题级别：1-4 级，None 表示不是标题。"""
        s = line.strip()
        # Markdown # 格式
        m = re.match(r'^(#{1,4})\s+', s)
        if m:
            return len(m.group(1))
        # 编号格式：1. xxx / 1.1 xxx / 1.1.1 xxx
        m = re.match(r'^(\d+(?:\.\d+){0,2})[.、]\s+', s)
        if m:
            parts = m.group(1).split('.')
            return min(len(parts), 4)
        return None

    orig_lines = original_content.split('\n')
    headings: list[str] = []
    body_lines: list[str] = []
    for line in orig_lines:
        level = _detect_heading_level(line)
        if level is not None:
            # 原文标题行，保留原样并提取
            headings.append(line)
        else:
            body_lines.append(line)
    body_only = '\n'.join(body_lines)

    # ── System Prompt（只留重点） ────────────────────────────────
    system = (
        "你是一个文本修改助手。只做一件事：按用户需求修改以下文字。\n"
        "规则：\n"
        "- 只修改文字内容，不要添加/删除标题（# ## ###）\n"
        "- 如果需求不明确，原样返回不要问\n"
        "- 不要解释，只输出修改后的文本"
    )

    # ── 构建 User Prompt ──────────────────────────────────────────
    # 不传章节名——LLM 会把它当成正文输出
    user_parts = [f"修改需求：{demand}", f"原文：\n{body_only}"]
    if word_count_instruction:
        user_parts.append(f"注意：{word_count_instruction}")
    user_prompt = "\n\n".join(user_parts)

    logger.info(
        "revise_content: chapter=%s, demand_len=%d, body_len=%d, headings=%d, wc_min=%d, wc_max=%d",
        chapter_title, len(demand), len(body_only), len(headings),
        word_count_min, word_count_max,
    )

    # 没有正文时直接返回标题（无需调 LLM）
    if not body_only.strip():
        return original_content

    content = await call_llm(system, user_prompt, model_name=model_name)
    if not content or not content.strip():
        logger.warning("revise_content: LLM 返回空, 回退到原文")
        return original_content

    content = _clean_llm_output(content).strip()

    # 安全校验：拒绝消息检测
    refusal = ["我不能", "无法满足", "无法执行", "I cannot", "I'm unable", "cannot fulfill"]
    for r in refusal:
        if r in content[:100]:
            logger.warning("revise_content: LLM 拒绝, 回退到原文")
            return original_content

    # 把标题拼回到修改后的正文前面
    if headings:
        return '\n'.join(headings) + '\n' + content
    return content


async def batch_generate_content(chapters: list[dict], project_name: str, doc_type: str, model_name: str = "") -> list[dict]:
    """一次 LLM 调用生成所有章节。"""
    detail_str = "\n\n".join(
        f"{i+1}. {c['chapter_title']}" +
        (f"\n     子主题：\n     - {c['chapter_description'].replace('|', '\n     - ')}" if c.get('chapter_description') else "")
        for i, c in enumerate(chapters)
    )
    system = """你是一个专业的技术文档写作助手。为每个章节生成详细内容。
输出 JSON：{"chapters":[{"title":"章标题","content":"内容..."}]}
要求：专业、每节500-1000字、覆盖子主题。"""
    user = f"文档类型：{doc_type}\n项目名称：{project_name}\n\n章节：\n{detail_str}"

    content = await call_llm(system, user, model_name=model_name)
    chapters_data = []
    json_parse_error = ""
    if content and content.strip():
        try:
            m = re.search(r"\{.*\}", content, re.DOTALL)
            data = json.loads(m.group()) if m else json.loads(content)
            chapters_data = data.get("chapters", [])
        except json.JSONDecodeError as e:
            json_parse_error = f"JSON 解析失败: {e}"
            logger.error("batch_generate_content: LLM 返回不是有效 JSON, raw=%s", content[:300])
        except Exception as e:
            json_parse_error = f"解析异常: {e}"
            logger.exception("batch_generate_content: 解析 LLM 响应异常")
    else:
        json_parse_error = "LLM 返回空内容"

    results = []
    for ch in chapters:
        matched = next((cd["content"] for cd in chapters_data if cd.get("title") == ch["chapter_title"]), "")
        is_fallback = not matched
        content_text = matched or f"【{ch['chapter_title']}】\n\n待撰写。"
        results.append({
            "content": content_text,
            "success": not is_fallback,
            "error": json_parse_error if is_fallback else "",
        })
    return results


OUTLINE_SYSTEM_PROMPT = """你是一个专业的技术文档大纲生成专家。根据用户提供的文档类型、项目名称和补充说明，生成针对性的大纲。

要求：
1. 大纲的一级标题必须紧密围绕项目主题，不要使用通用模板标题
2. 每个一级标题要有实际业务含义，贴合具体项目场景
3. 返回格式为 JSON 数组，每个元素包含 id、title、description、sub_titles 四个字段
4. id 从 "1" 开始递增，title 是一级标题，description 是对该章节内容的简要说明
5. sub_titles 是该一级标题下的二级标题数组（字符串列表），不需要二级标题时留空数组
6. 一级标题数量建议 4-7 个
7. 直接返回 JSON，不要 markdown 代码块标记"""

OUTLINE_L2_SYSTEM_PROMPT = """你是一个专业的技术文档大纲生成专家。用户已经有了一份一级标题大纲，现在需要为其中部分章节生成二级标题。

要求：
1. 严格保留用户提供的一级标题，不要修改、删除或新增一级标题
2. 只为标记了"需要N个二级标题"的章节生成对应数量的二级标题
3. 二级标题要贴合该章节的业务内容，不要用通用模板
4. 不需要二级标题的章节，其 sub_titles 留空数组
5. 返回格式为 JSON 数组，每个元素包含 id、title、description、sub_titles 四个字段
6. sub_titles 是字符串数组，每个字符串是一个二级标题
7. 直接返回 JSON，不要 markdown 代码块标记"""

OUTLINE_L3_SYSTEM_PROMPT = """你是一个专业的技术文档大纲生成专家。用户已有一级和二级大纲，需要你为部分二级标题补充三级标题。

返回格式：JSON 数组，每个元素代表一个一级标题。
一级标题格式：{"title": "一级标题名", "sub_titles": [二级标题对象, ...]}
二级标题对象格式：{"title": "二级标题名", "sub_titles": ["三级标题1", "三级标题2", ...]}

规则：
1. 严格保留所有一级标题和二级标题的名称和顺序，不要修改
2. 每个三级标题是一个简短的名词短语（6-15字）
3. 三级标题只放在它所属的二级标题的 sub_titles 数组中
4. 不需要三级标题的二级标题，sub_titles 留空数组
5. 直接返回 JSON，不要 markdown 代码块"""


async def generate_outline_ai(
    project_name: str,
    doc_type: str,
    description: str = "",
    existing_structure: list[dict] | None = None,
    model_name: str = "",
) -> list[dict]:
    """AI 根据项目信息动态生成大纲。支持逐级生成（L1 / L2 / L3）。

    existing_structure: 已有的章节结构，每项含 id/title/subCount/children。
                        为 None 时生成一级大纲；非 None 时基于已有结构生成下级子标题。
    """
    type_labels = {"report": "报告", "proposal": "方案", "thesis": "论文",
                   "manual": "说明书", "spec": "技术规范"}
    doc_label = type_labels.get(doc_type, doc_type)

    if existing_structure is None:
        # ── L1：生成一级大纲 ────────────────────────────────────
        desc_text = f"\n补充说明：{description}" if description else ""
        user_prompt = f"""文档类型：{doc_label}
项目名称：{project_name}{desc_text}

请为以上项目生成针对性的大纲，每个一级标题需要贴合项目主题，不要使用千篇一律的模板标题。"""
        raw = await call_llm(OUTLINE_SYSTEM_PROMPT, user_prompt, seed=42, model_name=model_name)
    else:
        # 判断当前层级（从 existing_structure 推断是否需要生成三级）
        needs_l3 = any(
            child.get("subCount", 0) > 0
            for parent in existing_structure
            for child in (parent.get("children") or [])
        )

        if needs_l3:
            # ── L3：基于一二级生成三级标题 ──────────────────────
            parts = []
            for parent in existing_structure:
                p_title = parent.get("title", "")
                children = parent.get("children") or []
                if not children:
                    parts.append(f'- "{p_title}"')
                else:
                    children_desc = "\n".join(
                        f'  - "{c.get("title", "")}"'
                        + (f'（需要 {c["subCount"]} 个三级标题）' if c.get("subCount", 0) > 0 else "（无三级标题）")
                        for c in children
                    )
                    parts.append(f'- "{p_title}"\n{children_desc}')
            structure_text = "\n".join(parts)

            user_prompt = f"""文档类型：{doc_label}
项目名称：{project_name}

已有大纲结构（一级→二级，标记了"需要N个三级标题"的二级标题需要补充三级标题）：
{structure_text}

严格按照以下结构返回 JSON，只填充三级标题内容，不修改任何一级和二级标题名称：

[
  {{"title": "一级标题A", "sub_titles": [
    {{"title": "二级标题1", "sub_titles": ["三级标题A1", "三级标题A2"]}},
    {{"title": "二级标题2", "sub_titles": []}}
  ]}},
  {{"title": "一级标题B", "sub_titles": []}}
]"""
            raw = await call_llm(OUTLINE_L3_SYSTEM_PROMPT, user_prompt, seed=42, model_name=model_name)
        else:
            # ── L2：基于一级生成二级标题 ────────────────────────
            parts = []
            for parent in existing_structure:
                p_title = parent.get("title", "")
                sub_count = parent.get("subCount", 0)
                if sub_count > 0:
                    parts.append(f'- "{p_title}"（需要 {sub_count} 个二级标题）')
                else:
                    parts.append(f'- "{p_title}"（无二级标题）')
            structure_text = "\n".join(parts)

            user_prompt = f"""文档类型：{doc_label}
项目名称：{project_name}

已有章节：
{structure_text}

请严格保留以上所有一级标题，只为需要二级标题的章节生成对应数量的二级标题。
每个章节的返回格式：{{"id": "1", "title": "一级标题", "description": "...", "sub_titles": ["二级标题1", "二级标题2"]}}"""
            raw = await call_llm(OUTLINE_L2_SYSTEM_PROMPT, user_prompt, seed=42, model_name=model_name)

    if not raw or not raw.strip():
        raise WritingError("AI 生成大纲失败：LLM 返回为空")

    try:
        chapters = json.loads(_clean_llm_json(raw))
        if not isinstance(chapters, list):
            raise ValueError("返回不是数组")
        result = []
        for i, ch in enumerate(chapters):
            if not isinstance(ch, dict):
                continue
            entry: dict = {
                "id": str(i + 1),
                "title": str(ch.get("title", "")).strip(),
                "description": str(ch.get("description", "")).strip(),
            }
            # 提取 sub_titles（L2 时是字符串数组，L3 时是 [{title, sub_titles}]）
            raw_sub = ch.get("sub_titles")
            if raw_sub and isinstance(raw_sub, list):
                parsed_subs: list = []
                has_nested = any(
                    isinstance(s, dict) and s.get("sub_titles")
                    for s in raw_sub
                )
                for s in raw_sub:
                    if isinstance(s, dict):
                        st = s.get("title", "")
                        if not st:
                            continue
                        nested = s.get("sub_titles")
                        if has_nested:
                            # L3 模式：统一转为 {title, sub_titles} 格式
                            parsed_subs.append({
                                "title": st,
                                "sub_titles": [str(x) for x in (nested or []) if isinstance(x, str) and x.strip()],
                            })
                        else:
                            parsed_subs.append(st)
                    elif isinstance(s, str) and s.strip():
                        if has_nested:
                            # 混合模式中将字符串也转为 dict
                            parsed_subs.append({"title": s.strip(), "sub_titles": []})
                        else:
                            parsed_subs.append(s.strip())
                if parsed_subs:
                    entry["sub_titles"] = parsed_subs
            result.append(entry)
        result = [r for r in result if r.get("title")]
        if not result:
            raise ValueError("所有标题均为空")
        return result
    except (json.JSONDecodeError, ValueError) as e:
        logger.warning("AI 大纲解析失败 (%s)，原始响应: %s", e, raw[:300])
        raise WritingError(f"AI 生成的大纲格式异常，请重试")


OUTLINES = {
    "report": [
        {"id": "1", "title": "概述", "description": "项目背景、目标和范围"},
        {"id": "2", "title": "现状分析", "description": "当前情况分析"},
        {"id": "3", "title": "需求分析", "description": "功能和非功能需求"},
        {"id": "4", "title": "方案设计", "description": "总体方案和技术路线"},
        {"id": "5", "title": "实施计划", "description": "时间计划和资源安排"},
        {"id": "6", "title": "风险评估", "description": "潜在风险和对策"},
        {"id": "7", "title": "总结", "description": "结论和下一步工作"},
    ],
    "proposal": [
        {"id": "1", "title": "项目背景", "description": "需求来源和项目背景"},
        {"id": "2", "title": "目标范围", "description": "项目目标和范围定义"},
        {"id": "3", "title": "技术方案", "description": "技术路线和架构设计"},
        {"id": "4", "title": "工作计划", "description": "实施计划和里程碑"},
        {"id": "5", "title": "预算估算", "description": "资源需求和成本估算"},
        {"id": "6", "title": "预期效益", "description": "项目收益和成果"},
    ],
    "thesis": [
        {"id": "1", "title": "绪论", "description": "研究背景、意义和国内外现状"},
        {"id": "2", "title": "理论基础", "description": "相关理论和技术基础"},
        {"id": "3", "title": "方法设计", "description": "研究方法和实验设计"},
        {"id": "4", "title": "实验分析", "description": "实验结果和数据分析"},
        {"id": "5", "title": "结论展望", "description": "研究结论和未来工作"},
    ],
    "manual": [
        {"id": "1", "title": "产品概述", "description": "产品简介和功能概要"},
        {"id": "2", "title": "安装部署", "description": "系统要求和安装步骤"},
        {"id": "3", "title": "使用指南", "description": "功能操作说明"},
        {"id": "4", "title": "配置说明", "description": "参数配置和环境设置"},
        {"id": "5", "title": "常见问题", "description": "故障排除和 FAQ"},
    ],
    "spec": [
        {"id": "1", "title": "范围", "description": "文档范围和适用系统"},
        {"id": "2", "title": "引用文档", "description": "参考标准和文档"},
        {"id": "3", "title": "设计决策", "description": "总体设计决策"},
        {"id": "4", "title": "体系结构设计", "description": "架构设计和模块划分"},
        {"id": "5", "title": "详细设计", "description": "各模块详细设计"},
        {"id": "6", "title": "需求可追踪性", "description": "需求与设计的对应关系"},
    ],
}


async def get_outline(doc_type: str, project_name: str = "", description: str = "",
                       existing_structure: list[dict] | None = None,
                       model_name: str = "") -> list[dict]:
    """获取文档大纲——优先用 AI 动态生成，失败时回退到模板。"""
    try:
        return await generate_outline_ai(project_name, doc_type, description, existing_structure, model_name=model_name)
    except WritingError:
        logger.warning("AI 大纲生成失败，回退到模板")
    except Exception:
        logger.exception("AI 大纲生成异常，回退到模板")

    # 回退：使用硬编码模板（仅 L1 生成时有效）
    if existing_structure:
        raise WritingError("AI 生成失败，无法生成子标题")
    if doc_type not in OUTLINES:
        raise WritingError(f"不支持的文档类型 '{doc_type}'，可选：{', '.join(OUTLINES.keys())}")
    chapters = [dict(c) for c in OUTLINES[doc_type]]
    if project_name:
        chapters[0]["description"] = f"{project_name} - {chapters[0]['description']}"
    return chapters


# ══════════════════════════════════════════════════════════════════════════
# 导出
# ══════════════════════════════════════════════════════════════════════════

async def export_md_to_docx(markdown: str, output_name: str = "output.docx") -> bytes:
    """Markdown → .docx 字节流。"""
    py_script = SKILLS_DIR / "md-to-docx-skill" / "scripts" / "convert_md_to_docx.py"
    if not py_script.exists():
        raise ServiceUnavailableError("md-to-docx-skill 脚本未找到")

    import tempfile
    md_file = Path(tempfile.mktemp(suffix=".md"))
    md_file.write_text(markdown, encoding="utf-8")

    out_path = Path(tempfile.mktemp(suffix=".docx"))
    try:
        cmd = ["python3", str(py_script), "--input", str(md_file), "--output", str(out_path)]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        if result.returncode != 0:
            raise WritingError(f"文档生成失败: {result.stderr}")
        if not out_path.exists():
            raise WritingError("文档生成失败：输出文件不存在")
        return out_path.read_bytes()
    except subprocess.TimeoutExpired:
        raise WritingError("文档生成超时", status_code=504)
    finally:
        md_file.unlink(missing_ok=True)
        out_path.unlink(missing_ok=True)


async def generate_title(project_name: str, doc_type: str, model_name: str = "") -> str:
    """AI 生成简洁标题。"""
    type_label = {"report": "报告", "proposal": "方案", "thesis": "论文",
                  "manual": "说明书", "spec": "技术规范"}.get(doc_type, doc_type)
    title = await call_llm(
        "你是一个标题生成专家。生成6字以内的简短标题，直接返回不要解释。",
        f"项目：{project_name}\n文档类型：{type_label}",
        model_name=model_name,
    )
    return (title.strip() if title and len(title) < 60 else (project_name or "未命名")[:60])


# ══════════════════════════════════════════════════════════════════════════
# LLM 输出后处理（清理行内代码、LaTeX 符号等）
# ══════════════════════════════════════════════════════════════════════════


def _clean_llm_output(text: str) -> str:
    """清理 LLM 生成内容中的特殊符号，使其能被富文本编辑器安全渲染。

    1. 移除行内代码（`` `code` `` → ``code``，保留文字本身）
    2. 替换 LaTeX 数学符号为可读文本或 Unicode
    """
    # 1) 行内代码：`` `text` `` → text（保留内容但不加 <code> 标记）
    # 注意不要匹配到 ``` 代码块
    # 先保护代码块（```...```），处理完行内代码再恢复
    code_blocks: list[str] = []
    def _save_cb(m: re.Match) -> str:
        code_blocks.append(m.group(0))
        return f"\x00CODEBLOCK{len(code_blocks)-1}\x00"

    def _restore_cb(m: re.Match) -> str:
        idx = int(m.group(1))
        return code_blocks[idx] if idx < len(code_blocks) else m.group(0)

    text = re.sub(r'```.+?```', _save_cb, text, flags=re.DOTALL)

    # 行内代码：`` `content` `` → content（去掉反引号）
    text = re.sub(r'`([^`]+)`', r'\1', text)

    text = re.sub(r'\x00CODEBLOCK(\d+)\x00', _restore_cb, text)

    # 2) LaTeX 符号替换（常见数学符号）
    latex_map = {
        r'\$?\\rightarrow\$?': '→',
        r'\$?\\Rightarrow\$?': '⇒',
        r'\$?\\leftarrow\$?': '←',
        r'\$?\\Leftarrow\$?': '⇐',
        r'\$?\\leftrightarrow\$?': '↔',
        r'\$?\\Leftrightarrow\$?': '⇔',
        r'\$?\\mapsto\$?': '↦',
        r'\$?\\longrightarrow\$?': '⟶',
        r'\$?\\Longrightarrow\$?': '⟹',
        r'\$?\\cdot\$?': '·',
        r'\$?\\times\$?': '×',
        r'\$?\\approx\$?': '≈',
        r'\$?\\neq\$?': '≠',
        r'\$?\\leq\$?': '≤',
        r'\$?\\geq\$?': '≥',
        r'\$?\\alpha\$?': 'α',
        r'\$?\\beta\$?': 'β',
        r'\$?\\gamma\$?': 'γ',
        r'\$?\\delta\$?': 'δ',
        r'\$?\\sum\$?': '∑',
        r'\$?\\prod\$?': '∏',
        r'\$?\\infty\$?': '∞',
        r'\$?\\partial\$?': '∂',
        r'\$?\\nabla\$?': '∇',
    }
    for pattern, replacement in latex_map.items():
        text = re.sub(pattern, replacement, text)

    # 3) 兜底：移除残余的独立 $ 符号（不成对的 $ 或 LaTeX 残留）
    # 先处理成对 $$...$$
    text = re.sub(r'\$\$(.+?)\$\$', r'\1', text)
    # 再处理单个 $...$
    text = re.sub(r'\$(.+?)\$', r'\1', text, flags=re.DOTALL)
    # 移除孤立 $
    text = text.replace('$', '')

    return text


# ══════════════════════════════════════════════════════════════════════════
# 后台批量生成（SSE 驱动）
# ══════════════════════════════════════════════════════════════════════════


async def background_generate_chapter(
    chapter: dict, project_name: str, doc_type: str,
    files: list | None = None,
    model_name: str = "",
    kb_context: str = "",
) -> str:
    """生成单个章节内容（供后台任务调用）。

    Args:
        kb_context: 由 KBContextResolver 预取的节点原文，
                    以纯文本注入，LLM 无工具权限。
    """
    logger.info("后台生成章节: title=%s", chapter.get("title"))
    ctx = ""
    if chapter.get("bodyText"):
        ctx = f"以下是模板占位正文：\n{chapter['bodyText'][:2000]}"
    if files:
        desc = next((f for f in files if f.get("type") == "description"), None)
        if desc:
            desc_path = Path(desc.get("path", ""))
            if desc_path.exists():
                try:
                    desc_content = desc_path.read_text(encoding="utf-8")
                    ctx += f"\n\n对象说明：\n{desc_content[:3000]}"
                except Exception:
                    ctx += f"\n（对象说明文件已上传但无法读取）"
    structure = chapter.get("structure", [])
    result = await generate_content(
        chapter["title"], project_name, doc_type,
        context=ctx, structure=structure,
        model_name=model_name,
        kb_context=kb_context,
    )
    # 清理 LLM 输出中的行内代码和 LaTeX 符号，确保 WangEditor/Slate 能安全渲染
    result = _clean_llm_output(result)
    logger.info("后台生成完成: title=%s, 长度=%d", chapter.get("title"), len(result or ""))
    return md_to_html(result)


# ══════════════════════════════════════════════════════════════════════════
# HTML → docx 导出
# ══════════════════════════════════════════════════════════════════════════

def export_html_to_docx(html: str) -> bytes:
    """HTML → .docx 字节流（直接转换，保留全部格式）。"""
    from .html_to_docx import html_to_docx
    return html_to_docx(html)
