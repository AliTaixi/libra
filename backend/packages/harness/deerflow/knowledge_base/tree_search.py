"""Tree Search — LLM-powered reasoning navigation over PageIndex tree structures.

Core idea: Instead of embedding-based similarity search, we use the LLM
to reason about which tree nodes are relevant to the user's query.
This simulates how a human expert navigates a document's table of contents.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from deerflow.knowledge_base.pageindex_engine.utils import (
    structure_to_list,
    format_structure,
)

logger = logging.getLogger(__name__)


async def tree_search_pipeline(
    structure: list[dict],
    query: str,
    model: Any = None,
    max_nodes: int = 5,
) -> dict:
    """Run the tree search pipeline over a document's tree structure.

    Steps:
    1. Flatten tree to list of nodes (with summaries if available)
    2. Ask LLM to rank nodes by relevance to query
    3. Return top-k matched node IDs

    Args:
        structure: PageIndex tree structure (list of root nodes).
        query: User's question.
        model: LangChain chat model instance.
        max_nodes: Maximum number of nodes to return.

    Returns:
        Dict with matched_node_ids and optionally reasoning.
    """
    # Step 1: Flatten tree to list for LLM evaluation
    all_nodes = structure_to_list(structure)

    if not all_nodes:
        return {"matched_node_ids": []}

    # Step 2: Use LLM to find relevant nodes
    if model is not None and hasattr(model, "ainvoke"):
        matched_ids = await _llm_node_selection(
            nodes=all_nodes,
            query=query,
            model=model,
            max_nodes=max_nodes,
        )
    else:
        # Fallback: keyword matching
        matched_ids = _keyword_match(all_nodes, query, max_nodes)

    return {"matched_node_ids": matched_ids}


async def _llm_node_selection(
    nodes: list[dict],
    query: str,
    model: Any,
    max_nodes: int = 5,
) -> list[str]:
    """Ask LLM to select the most relevant nodes from the tree structure.

    We present the tree as a compact table-of-contents with summaries,
    and ask the LLM to identify which sections are most relevant.
    """
    from langchain_core.messages import HumanMessage

    # Build a compact representation of the tree for the LLM
    node_table = _build_node_table(nodes)

    prompt = f"""You are navigating a document's table of contents to find sections relevant to a question.

For each node (title + summary), decide if it's relevant to the question.
Return a JSON array of node_ids that are most relevant, in order of relevance.
Return at most {max_nodes} node_ids. If none are relevant, return an empty array.

Question: {query}

Nodes:
{node_table}

Return ONLY a JSON array of node_ids, nothing else:"""

    try:
        response = await model.ainvoke([HumanMessage(content=prompt)])
        content = (
            response.content.strip()
            if hasattr(response, "content")
            else str(response)
        )

        from deerflow.knowledge_base.pageindex_engine.utils import extract_json

        result = extract_json(content)
        if isinstance(result, list):
            return [str(r) for r in result if r]
        if isinstance(result, dict):
            # Sometimes LLM returns {"node_ids": [...]} or similar
            for val in result.values():
                if isinstance(val, list):
                    return [str(v) for v in val if v]
            return []
        return []
    except Exception as e:
        logger.warning("LLM node selection failed: %s, falling back to keyword", e)
        return _keyword_match(nodes, query, max_nodes)


def _keyword_match(
    nodes: list[dict],
    query: str,
    max_nodes: int = 5,
) -> list[str]:
    """Simple keyword matching fallback when LLM is unavailable."""
    query_lower = query.lower()
    keywords = set(query_lower.split())

    scored: list[tuple[int, str]] = []
    for node in nodes:
        title = (node.get("title", "") or "").lower()
        summary = (node.get("summary", "") or "").lower()
        text = (node.get("text", "") or "").lower()[:500]

        combined = f"{title} {summary} {text}"
        score = sum(1 for kw in keywords if kw in combined)
        # Bonus for exact phrase match in title
        if query_lower in title:
            score += 5

        if score > 0:
            scored.append((score, node.get("node_id", "")))

    scored.sort(key=lambda x: -x[0])
    return [node_id for _, node_id in scored[:max_nodes]]


def _build_node_table(nodes: list[dict]) -> str:
    """Build a compact text representation of the tree for LLM evaluation."""
    lines: list[str] = []
    for i, node in enumerate(nodes):
        title = node.get("title", "")
        node_id = node.get("node_id", "")
        summary = (
            node.get("summary")
            or node.get("prefix_summary", "")
            or ""
        )
        summary_short = summary[:200] if len(summary) > 200 else summary

        if summary_short:
            lines.append(
                f'  {{"node_id": "{node_id}", "title": "{title}", '
                f'"summary": "{summary_short}"}}'
            )
        else:
            lines.append(
                f'  {{"node_id": "{node_id}", "title": "{title}"}}'
            )

    return "[\n" + ",\n".join(lines) + "\n]"
