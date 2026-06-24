"""Document image processor — extract images from PDF/DOCX/PPTX
and describe them using the vision LLM, all in parallel.

Hooks into file_conversion.py: after text extraction, images are
extracted and sent to the vision model concurrently. Descriptions
are appended to the markdown output so the KB index and writing
workflow can reference them.
"""

from __future__ import annotations

import asyncio
import base64
import logging
import os
import tempfile
from pathlib import Path
from typing import Any

logger = logging.getLogger("deerflow.utils.image_processor")

# ── Supported file types ──────────────────────────────────────────────

IMAGE_EXTRACTORS: dict[str, str] = {
    ".pdf": "pdf",
    ".docx": "docx",
    ".doc": "docx",
    ".pptx": "pptx",
    ".ppt": "pptx",
}

# ── Image extraction ──────────────────────────────────────────────────


def _extract_images_from_pdf(file_path: Path) -> list[dict[str, Any]]:
    """Extract all embedded images from a PDF using pymupdf.

    Returns list of {data: bytes, ext: str, page: int, index: int}.
    """
    import fitz

    images: list[dict[str, Any]] = []
    doc = fitz.open(str(file_path))
    try:
        for page_num in range(len(doc)):
            page = doc[page_num]
            img_list = page.get_images(full=True)
            for idx, img in enumerate(img_list):
                xref = img[0]
                base = doc.extract_image(xref)
                images.append({
                    "data": base["image"],
                    "ext": base["ext"],
                    "page": page_num + 1,
                    "index": idx + 1,
                })
    finally:
        doc.close()
    return images


def _extract_images_from_docx(file_path: Path) -> list[dict[str, Any]]:
    """Extract all embedded images from a DOCX using python-docx.

    python-docx stores images as relationships in the OPC package.
    """
    from docx import Document

    images: list[dict[str, Any]] = []
    doc = Document(str(file_path))
    for rel in doc.part.rels.values():
        if "image" in rel.reltype:
            # Determine extension from content type
            content_type = rel.target_part.content_type or ""
            ext = content_type.split("/")[-1] if "/" in content_type else "png"
            ext = ext.replace("jpeg", "jpg").replace("vnd.microsoft.icon", "ico")
            images.append({
                "data": rel.target_part.blob,
                "ext": ext,
                "page": 0,
                "index": len(images) + 1,
            })
    return images


def _extract_images_from_pptx(file_path: Path) -> list[dict[str, Any]]:
    """Extract all images from a PPTX.

    PPTX is a ZIP package; images are in ppt/media/.
    """
    from zipfile import ZipFile

    images: list[dict[str, Any]] = []
    with ZipFile(str(file_path)) as z:
        for name in z.namelist():
            if name.startswith("ppt/media/") or name.startswith("ppt/images/"):
                ext = Path(name).suffix.lstrip(".") or "png"
                ext = ext.replace("jpeg", "jpg")
                images.append({
                    "data": z.read(name),
                    "ext": ext,
                    "page": 0,
                    "index": len(images) + 1,
                })
    return images


def extract_images(file_path: Path) -> list[dict[str, Any]]:
    """Extract images from a supported document file.

    Dispatches to the correct extractor based on file extension.
    Returns empty list if the format is unsupported or extraction fails.
    """
    ext = file_path.suffix.lower()
    handler = IMAGE_EXTRACTORS.get(ext)
    if handler is None:
        return []

    try:
        if handler == "pdf":
            return _extract_images_from_pdf(file_path)
        elif handler == "docx":
            return _extract_images_from_docx(file_path)
        elif handler == "pptx":
            return _extract_images_from_pptx(file_path)
    except Exception as e:
        logger.warning("Failed to extract images from %s: %s", file_path.name, e)
        return []


# ── Vision LLM description ────────────────────────────────────────────


async def _describe_single_image(
    image_data: bytes,
    image_ext: str,
    model: Any,
    page_num: int = 0,
    index: int = 0,
) -> str:
    """Send one image to the vision LLM and return its description.

    The image is encoded as base64 data URI (OpenAI-compatible format
    supported by Ollama's vision models).
    """
    mime_map = {"jpg": "image/jpeg", "jpeg": "image/jpeg",
                "png": "image/png", "webp": "image/webp",
                "gif": "image/gif", "bmp": "image/bmp"}
    mime = mime_map.get(image_ext, "image/png")

    img_b64 = base64.b64encode(image_data).decode("utf-8")
    data_uri = f"data:{mime};base64,{img_b64}"

    from langchain_core.messages import HumanMessage

    location = f"第{page_num}页" if page_num else f"文档中"
    prompt = (
        f"这是一张来自文档{location}的图片（编号{index}）。请：\n"
        "1. 如果图片中包含文字，完整提取所有文字内容\n"
        "2. 如果图片是图表/流程图/架构图，用自然语言描述其结构和含义\n"
        "3. 如果图片是照片，描述其内容\n"
        "请用中文回答。"
    )

    try:
        msg = HumanMessage(content=[
            {"type": "text", "text": prompt},
            {"type": "image_url", "image_url": {"url": data_uri}},
        ])
        response = await model.ainvoke([msg])
        text = response.content.strip() if hasattr(response, "content") else str(response).strip()
        if text:
            return f"\n\n[文档图片 {location} 编号{index}]\n{text}\n[/图片{index}]"
    except Exception as e:
        logger.warning("Vision LLM failed on image %d: %s", index, e)

    return ""


# ── Main processor ────────────────────────────────────────────────────


async def process_document_images(
    file_path: Path,
    model: Any,
    max_concurrency: int = 5,
) -> str:
    """Extract images from a document and describe them using vision LLM.

    All image descriptions run concurrently via asyncio.gather (batched
    by max_concurrency to avoid overwhelming the model).

    Args:
        file_path: Path to the document (PDF, DOCX, PPTX).
        model: LangChain chat model instance with vision support.
        max_concurrency: Max parallel vision calls.

    Returns:
        A string containing all image descriptions, ready to append
        to the markdown output. Empty string if no images found.
    """
    images = extract_images(file_path)
    if not images:
        logger.info("No images found in %s", file_path.name)
        return ""

    logger.info("Found %d images in %s, describing with vision LLM...", len(images), file_path.name)

    # Process in batches to control concurrency
    descriptions: list[str] = []
    for i in range(0, len(images), max_concurrency):
        batch = images[i:i + max_concurrency]
        tasks = [
            _describe_single_image(
                img["data"], img["ext"], model,
                page_num=img.get("page", 0),
                index=img.get("index", 0),
            )
            for img in batch
        ]
        results = await asyncio.gather(*tasks)
        descriptions.extend(r for r in results if r)

    if descriptions:
        result = "\n\n" + ("─" * 40) + "\n以下为文档中的图片内容识别结果：\n" + "\n".join(descriptions)
        logger.info("Generated descriptions for %d/%d images", len(descriptions), len(images))
        return result

    return ""
