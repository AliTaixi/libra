"""Retrieval functions adapted from PageIndex for DeerFlow.

Provides three core retrieval operations:
1. get_document() — document metadata (page/line count, description)
2. get_document_structure() — tree structure without text (for LLM navigation)
3. get_page_content() — content of specific pages/lines
"""

from __future__ import annotations

import json
import logging
from typing import Any

from deerflow.knowledge_base.pageindex_engine.utils import remove_structure_text

logger = logging.getLogger(__name__)


def _parse_pages(pages_str: str) -> list[int]:
    """Parse a pages string like '5-7', '3,8', or '12' into a sorted list of ints.

    Raises ValueError on invalid format.
    """
    result: list[int] = []
    for part in pages_str.split(","):
        part = part.strip()
        if "-" in part:
            parts = part.split("-", 1)
            start, end = int(parts[0].strip()), int(parts[1].strip())
            if start > end:
                raise ValueError(f"Invalid range '{part}': start must be <= end")
            result.extend(range(start, end + 1))
        else:
            result.append(int(part))
    return sorted(set(result))


def _get_md_page_content(doc_info: dict, line_nums: list[int]) -> list[dict]:
    """For Markdown documents, 'pages' are line numbers.

    Find nodes whose line_num falls within [min(line_nums), max(line_nums)]
    and return their text content.
    """
    min_line, max_line = min(line_nums), max(line_nums)
    results: list[dict] = []
    seen: set[int] = set()

    def _traverse(nodes: list[dict]) -> None:
        for node in nodes:
            ln = node.get("line_num")
            if ln and min_line <= ln <= max_line and ln not in seen:
                seen.add(ln)
                results.append({"page": ln, "content": node.get("text", "")})
            if node.get("nodes"):
                _traverse(node["nodes"])

    _traverse(doc_info.get("structure", []))
    results.sort(key=lambda x: x["page"])
    return results


def get_document(documents: dict[str, Any], doc_id: str) -> str:
    """Return JSON with document metadata: doc_id, doc_name, doc_description, type, status, line_count.

    Args:
        documents: Dict of {doc_id: doc_info}.
        doc_id: Document identifier.

    Returns:
        JSON string with document metadata.
    """
    doc_info = documents.get(doc_id)
    if not doc_info:
        return json.dumps({"error": f"Document {doc_id} not found"})

    result: dict[str, Any] = {
        "doc_id": doc_id,
        "doc_name": doc_info.get("doc_name", ""),
        "doc_description": doc_info.get("doc_description", ""),
        "type": doc_info.get("type", "markdown"),
        "status": "completed",
        "line_count": doc_info.get("line_count", 0),
    }
    return json.dumps(result)


def get_document_structure(documents: dict[str, Any], doc_id: str) -> str:
    """Return tree structure JSON with text fields removed (saves tokens).

    Args:
        documents: Dict of {doc_id: doc_info}.
        doc_id: Document identifier.

    Returns:
        JSON string of the tree structure without text content.
    """
    doc_info = documents.get(doc_id)
    if not doc_info:
        return json.dumps({"error": f"Document {doc_id} not found"})

    structure = doc_info.get("structure", [])
    structure_no_text = remove_structure_text(structure)
    return json.dumps(structure_no_text, ensure_ascii=False)


def get_page_content(documents: dict[str, Any], doc_id: str, pages: str) -> str:
    """Retrieve page content for a document.

    For Markdown: pages are line numbers corresponding to node headers.
    Format: '5-7', '3,8', or '12'.

    Args:
        documents: Dict of {doc_id: doc_info}.
        doc_id: Document identifier.
        pages: Page range string.

    Returns:
        JSON list of {'page': int, 'content': str}.
    """
    doc_info = documents.get(doc_id)
    if not doc_info:
        return json.dumps({"error": f"Document {doc_id} not found"})

    try:
        page_nums = _parse_pages(pages)
    except (ValueError, AttributeError) as e:
        return json.dumps({
            "error": f"Invalid pages format: '{pages}'. Use '5-7', '3,8', or '12'. Error: {e}"
        })

    try:
        content = _get_md_page_content(doc_info, page_nums)
    except Exception as e:
        return json.dumps({"error": f"Failed to read page content: {e}"})

    return json.dumps(content, ensure_ascii=False)
