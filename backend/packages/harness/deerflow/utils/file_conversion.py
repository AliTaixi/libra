"""File conversion utilities.

Converts document files (PDF, PPT, Excel, Word) to Markdown.

PDF conversion strategy (auto mode):
  1. Try pymupdf4llm if installed — better heading detection, faster on most files.
  2. If output is suspiciously short (< _MIN_CHARS_PER_PAGE chars/page, or < 200 chars
     total when page count is unavailable), treat as image-based and fall back to MarkItDown.
  3. If pymupdf4llm is not installed, use MarkItDown directly (existing behaviour).

Large files (> ASYNC_THRESHOLD_BYTES) are converted in a thread pool via
asyncio.to_thread() to avoid blocking the event loop (fixes #1569).

No FastAPI or HTTP dependencies — pure utility functions.
"""

import asyncio
import logging
import re
from pathlib import Path

from deerflow.config.app_config import get_app_config

logger = logging.getLogger(__name__)

# File extensions that should be converted to markdown
CONVERTIBLE_EXTENSIONS = {
    ".pdf",
    ".ppt",
    ".pptx",
    ".xls",
    ".xlsx",
    ".doc",
    ".docx",
}

# Files larger than this threshold are converted in a background thread.
# Small files complete in < 1s synchronously; spawning a thread adds unnecessary
# scheduling overhead for them.
_ASYNC_THRESHOLD_BYTES = 1 * 1024 * 1024  # 1 MB

# If pymupdf4llm produces fewer characters *per page* than this threshold,
# the PDF is likely image-based or encrypted — fall back to MarkItDown.
# Rationale: normal text PDFs yield 200-2000 chars/page; image-based PDFs
# yield close to 0. 50 chars/page gives a wide safety margin.
# Falls back to absolute 200-char check when page count is unavailable.
_MIN_CHARS_PER_PAGE = 50


def _pymupdf_output_too_sparse(text: str, file_path: Path) -> bool:
    """Return True if pymupdf4llm output is suspiciously short (image-based PDF).

    Uses chars-per-page rather than an absolute threshold so that both short
    documents (few pages, few chars) and long documents (many pages, many chars)
    are handled correctly.
    """
    chars = len(text.strip())
    doc = None
    pages: int | None = None
    try:
        import pymupdf

        doc = pymupdf.open(str(file_path))
        pages = len(doc)
    except Exception:
        pass
    finally:
        if doc is not None:
            try:
                doc.close()
            except Exception:
                pass
    if pages is not None and pages > 0:
        return (chars / pages) < _MIN_CHARS_PER_PAGE
    # Fallback: absolute threshold when page count is unavailable
    return chars < 200


def _convert_pdf_with_pymupdf4llm(file_path: Path) -> str | None:
    """Attempt PDF conversion with pymupdf4llm.

    Returns the markdown text, or None if pymupdf4llm is not installed or
    if conversion fails (e.g. encrypted/corrupt PDF).
    """
    try:
        import pymupdf4llm
    except ImportError:
        return None

    try:
        return pymupdf4llm.to_markdown(str(file_path))
    except Exception:
        logger.exception("pymupdf4llm failed to convert %s; falling back to MarkItDown", file_path.name)
        return None


def _convert_with_markitdown(file_path: Path) -> str:
    """Convert any supported file to markdown text using MarkItDown."""
    from markitdown import MarkItDown

    md = MarkItDown()
    return md.convert(str(file_path)).text_content


def _do_convert(file_path: Path, pdf_converter: str) -> str:
    """Synchronous conversion — called directly or via asyncio.to_thread.

    Args:
        file_path: Path to the file.
        pdf_converter: "auto" | "pymupdf4llm" | "markitdown"
    """
    is_pdf = file_path.suffix.lower() == ".pdf"

    if is_pdf and pdf_converter != "markitdown":
        # Try pymupdf4llm first (auto or explicit)
        pymupdf_text = _convert_pdf_with_pymupdf4llm(file_path)

        if pymupdf_text is not None:
            # pymupdf4llm is installed
            if pdf_converter == "pymupdf4llm":
                # Explicit — use as-is regardless of output length
                return pymupdf_text
            # auto mode: fall back if output looks like a failed parse.
            # Use chars-per-page to distinguish image-based PDFs (near 0) from
            # legitimately short documents.
            if not _pymupdf_output_too_sparse(pymupdf_text, file_path):
                return pymupdf_text
            logger.warning(
                "pymupdf4llm produced only %d chars for %s (likely image-based PDF); falling back to MarkItDown",
                len(pymupdf_text.strip()),
                file_path.name,
            )
        # pymupdf4llm not installed or fallback triggered → use MarkItDown

    return _convert_with_markitdown(file_path)


async def _convert_with_mineru(file_path: Path) -> str | None:
    """调用 MinerU API 解析文档，返回 Markdown 内容。

    MinerU 3.x API 为异步模式：
      1. POST /file_parse → 返回 task_id
      2. GET  /tasks/{task_id}/result → 获取 Markdown 结果
    """
    import httpx
    import asyncio

    mineru_url = os.environ.get("MINERU_API_URL", "http://mineru:8000")

    async with httpx.AsyncClient(timeout=600.0) as client:
        try:
            with open(file_path, "rb") as f:
                resp = await client.post(
                    f"{mineru_url}/file_parse",
                    files={"files": (file_path.name, f)},
                )
            if resp.status_code != 200:
                logger.warning("MinerU upload failed: HTTP %d", resp.status_code)
                return None

            task = resp.json()
            task_id = task.get("task_id")
            if not task_id:
                return None

            # 轮询等待结果
            status = task.get("status", "processing")
            for _ in range(60):  # 最多等 60 次 × 2s = 2 分钟
                if status == "completed":
                    break
                await asyncio.sleep(2)
                status_resp = await client.get(f"{mineru_url}/tasks/{task_id}")
                if status_resp.status_code == 200:
                    task = status_resp.json()
                    status = task.get("status", "processing")

            if status != "completed":
                logger.warning("MinerU task %s did not complete: %s", task_id, status)
                return None

            # 获取结果
            result_resp = await client.get(f"{mineru_url}/tasks/{task_id}/result")
            if result_resp.status_code != 200:
                return None

            result = result_resp.json()
            # 取第一个文件的结果
            results = result.get("results") or {}
            first_result = next(iter(results.values()), {})
            md = first_result.get("md_content") or first_result.get("markdown") or ""
            if md:
                logger.info("MinerU parsed %s (%d chars)", file_path.name, len(md))
                return md

        except (httpx.HTTPError, OSError) as e:
            logger.warning("MinerU request failed: %s", e)

    logger.info("MinerU unavailable for %s, falling back", file_path.name)
    return None


async def convert_file_to_markdown(file_path: Path) -> Path | None:
    """Convert a supported document file to Markdown.

    ｜v2｜ MinerU API 作为首选解析引擎，支持 PDF/DOCX/PPTX，
    自动完成 OCR、版面分析、表格还原和图片提取。
    当 MinerU 不可用时自动回退到本地转换 + 视觉模型。
    """
    try:
        # ── Step 1: 尝试 MinerU 解析 ────────────────────────────────
        mineru_md = await _convert_with_mineru(file_path)
        if mineru_md:
            md_path = file_path.with_suffix(".md")
            md_path.write_text(mineru_md, encoding="utf-8")
            logger.info("MinerU converted %s (%d chars)", file_path.name, len(mineru_md))
            return md_path

        # ── Step 2: 回退到本地转换 ──────────────────────────────────
        pdf_converter = _get_pdf_converter()
        file_size = file_path.stat().st_size

        if file_size > _ASYNC_THRESHOLD_BYTES:
            text = await asyncio.to_thread(_do_convert, file_path, pdf_converter)
        else:
            text = _do_convert(file_path, pdf_converter)

        # ── Step 3: 提取图片并用视觉模型描述（回退路径） ────────────
        ext = file_path.suffix.lower()
        image_extractors = {".pdf", ".docx", ".doc", ".pptx", ".ppt"}
        if ext in image_extractors:
            try:
                from deerflow.utils.image_processor import process_document_images
                from deerflow.models.factory import create_chat_model
                from deerflow.config import get_app_config

                config = get_app_config()
                kb_cfg = getattr(config, "knowledge_base", None) or {}
                vision_model_name = "gemma4-cloud"
                if isinstance(kb_cfg, dict):
                    vision_model_name = kb_cfg.get("model", vision_model_name)
                elif hasattr(kb_cfg, "model"):
                    vision_model_name = kb_cfg.model

                vision_model = create_chat_model(vision_model_name, app_config=config)
                image_desc = await process_document_images(file_path, vision_model)
                if image_desc:
                    text += image_desc
            except Exception as e:
                logger.warning("Image processing failed for %s (non-fatal): %s", file_path.name, e)

        md_path = file_path.with_suffix(".md")
        md_path.write_text(text, encoding="utf-8")
        logger.info("Converted %s to markdown: %s (%d chars)", file_path.name, md_path.name, len(text))
        return md_path
    except Exception as e:
        logger.error("Failed to convert %s to markdown: %s", file_path.name, e)
        return None


# Regex for bold-only lines that look like section headings.
# Targets SEC filing structural headings that pymupdf4llm renders as **bold**
# rather than # Markdown headings (because they use same font size as body text,
# distinguished only by bold+caps formatting).
#
# Pattern requires ALL of:
#   1. Entire line is a single **...** block (no surrounding prose)
#   2. Starts with a recognised structural keyword:
#      - ITEM / PART / SECTION (with optional number/letter after)
#      - SCHEDULE, EXHIBIT, APPENDIX, ANNEX, CHAPTER
#      All-caps addresses, boilerplate ("CURRENT REPORT", "SIGNATURES",
#      "WASHINGTON, DC 20549") do NOT start with these keywords and are excluded.
#
# Chinese headings (第三节...) are already captured as standard # headings
# by pymupdf4llm, so they don't need this pattern.
_BOLD_HEADING_RE = re.compile(r"^\*\*((ITEM|PART|SECTION|SCHEDULE|EXHIBIT|APPENDIX|ANNEX|CHAPTER)\b[A-Z0-9 .,\-]*)\*\*\s*$")

# Regex for split-bold headings produced by pymupdf4llm when a heading spans
# multiple text spans in the PDF (e.g. section number and title are separate spans).
# Matches lines like:  **1** **Introduction**  or  **3.2** **Multi-Head Attention**
# Requirements:
#   1. Entire line consists only of **...** blocks separated by whitespace (no prose)
#   2. First block is a section number (digits and dots, e.g. "1", "3.2", "A.1")
#   3. Second block must not be purely numeric/punctuation — excludes financial table
#      headers like **2023** **2022** **2021** while allowing non-ASCII titles such as
#      **1** **概述** or accented words (negative lookahead instead of [A-Za-z])
#   4. At most two additional blocks (four total) with [^*]+ (no * inside) to keep
#      the regex linear and avoid ReDoS on attacker-controlled content
_SPLIT_BOLD_HEADING_RE = re.compile(r"^\*\*[\dA-Z][\d\.]*\*\*\s+\*\*(?!\d[\d\s.,\-–—/:()%]*\*\*)[^*]+\*\*(?:\s+\*\*[^*]+\*\*){0,2}\s*$")

# Maximum number of outline entries injected into the agent context.
# Keeps prompt size bounded even for very long documents.
MAX_OUTLINE_ENTRIES = 50

_ALLOWED_PDF_CONVERTERS = {"auto", "pymupdf4llm", "markitdown"}


def _clean_bold_title(raw: str) -> str:
    """Normalise a title string that may contain pymupdf4llm bold artefacts.

    pymupdf4llm sometimes emits adjacent bold spans as ``**A** **B**`` instead
    of a single ``**A B**`` block.  This helper merges those fragments and then
    strips the outermost ``**...**`` wrapper so the caller gets plain text.

    Examples::

        "**Overview**"                       → "Overview"
        "**UNITED STATES** **SECURITIES**"   → "UNITED STATES SECURITIES"
        "plain text"                         → "plain text"  (unchanged)
    """
    # Merge adjacent bold spans: "** **" → " "
    merged = re.sub(r"\*\*\s*\*\*", " ", raw).strip()
    # Strip outermost **...** if the whole string is wrapped
    if m := re.fullmatch(r"\*\*(.+?)\*\*", merged, re.DOTALL):
        return m.group(1).strip()
    return merged


def extract_outline(md_path: Path) -> list[dict]:
    """Extract document outline (headings) from a Markdown file.

    Recognises three heading styles produced by pymupdf4llm:

    1. Standard Markdown headings: lines starting with one or more '#'.
       Inline ``**...**`` wrappers and adjacent bold spans (``** **``) are
       cleaned so the title is plain text.

    2. Bold-only structural headings: ``**ITEM 1. BUSINESS**``, ``**PART II**``,
       etc.  SEC filings use bold+caps for section headings with the same font
       size as body text, so pymupdf4llm cannot promote them to # headings.

    3. Split-bold headings: ``**1** **Introduction**``, ``**3.2** **Attention**``.
       pymupdf4llm emits these when the section number and title text are
       separate spans in the underlying PDF (common in academic papers).

    Args:
        md_path: Path to the .md file.

    Returns:
        List of dicts with keys: title (str), line (int, 1-based).
        When the outline is truncated at MAX_OUTLINE_ENTRIES, a sentinel entry
        ``{"truncated": True}`` is appended as the last element so callers can
        render a "showing first N headings" hint without re-scanning the file.
        Returns an empty list if the file cannot be read or has no headings.
    """
    outline: list[dict] = []
    try:
        with md_path.open(encoding="utf-8") as f:
            for lineno, line in enumerate(f, 1):
                stripped = line.strip()
                if not stripped:
                    continue

                # Style 1: standard Markdown heading
                if stripped.startswith("#"):
                    title = _clean_bold_title(stripped.lstrip("#").strip())
                    if title:
                        outline.append({"title": title, "line": lineno})

                # Style 2: single bold block with SEC structural keyword
                elif m := _BOLD_HEADING_RE.match(stripped):
                    title = m.group(1).strip()
                    if title:
                        outline.append({"title": title, "line": lineno})

                # Style 3: split-bold heading — **<num>** **<title>**
                # Regex already enforces max 4 blocks and non-numeric second block.
                elif _SPLIT_BOLD_HEADING_RE.match(stripped):
                    title = " ".join(re.findall(r"\*\*([^*]+)\*\*", stripped))
                    if title:
                        outline.append({"title": title, "line": lineno})

                if len(outline) >= MAX_OUTLINE_ENTRIES:
                    outline.append({"truncated": True})
                    break
    except Exception:
        return []

    return outline


def _get_uploads_config_value(key: str, default: object) -> object:
    """Read a value from the uploads config, supporting dict and attribute access."""
    cfg = get_app_config()
    uploads_cfg = getattr(cfg, "uploads", None)
    if isinstance(uploads_cfg, dict):
        return uploads_cfg.get(key, default)
    return getattr(uploads_cfg, key, default)


def _get_pdf_converter() -> str:
    """Read pdf_converter setting from app config, defaulting to 'auto'.

    Normalizes the value to lowercase and validates it against the allowed set
    so that values like 'AUTO' or 'MarkItDown' from config.yaml don't silently
    fall through to unexpected behaviour.
    """
    try:
        raw = str(_get_uploads_config_value("pdf_converter", "auto")).strip().lower()
        if raw not in _ALLOWED_PDF_CONVERTERS:
            logger.warning("Invalid pdf_converter value %r; falling back to 'auto'", raw)
            return "auto"
        return raw
    except Exception:
        pass
    return "auto"
