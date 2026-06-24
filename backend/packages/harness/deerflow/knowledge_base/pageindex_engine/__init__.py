"""PageIndex Engine — Adapted core algorithms for vectorless RAG.

Extracted from https://github.com/VectifyAI/PageIndex and adapted for DeerFlow.
Key differences from upstream:
- Uses langchain model instances (not litellm) for LLM calls
- No PyPDF2 dependency (markdown-only tree building)
- No cloud client code
- Async-first API
"""

from deerflow.knowledge_base.pageindex_engine.page_index_md import md_to_tree
from deerflow.knowledge_base.pageindex_engine.retrieve import (
    get_document,
    get_document_structure,
    get_page_content,
)
from deerflow.knowledge_base.pageindex_engine.utils import (
    count_tokens,
    extract_json,
    format_structure,
    structure_to_list,
    write_node_id,
)

__all__ = [
    "md_to_tree",
    "get_document",
    "get_document_structure",
    "get_page_content",
    "count_tokens",
    "extract_json",
    "format_structure",
    "structure_to_list",
    "write_node_id",
]
