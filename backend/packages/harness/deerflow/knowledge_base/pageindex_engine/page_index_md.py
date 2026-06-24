"""Markdown tree building — adapted from PageIndex.

Takes a Markdown file and builds a hierarchical tree index.
Core algorithm extracted from PageIndex (https://github.com/VectifyAI/PageIndex).
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
from typing import Any

from deerflow.knowledge_base.pageindex_engine.utils import (
    count_tokens,
    format_structure,
    generate_doc_description_prompt,
    generate_node_summary_prompt,
    structure_to_list,
    write_node_id,
)

logger = logging.getLogger(__name__)


def extract_nodes_from_markdown(markdown_content: str) -> tuple[list[dict], list[str]]:
    """Extract header-based nodes from markdown content.

    Parses # to ###### headers, skipping code blocks.

    Returns:
        Tuple of (node_list, lines) where each node has title and line_num.
    """
    header_pattern = re.compile(r"^(#{1,6})\s+(.+)$", re.MULTILINE)
    code_block_pattern = re.compile(r"^```")
    node_list: list[dict] = []
    lines = markdown_content.split("\n")
    in_code_block = False

    for line_num, line in enumerate(lines, 1):
        stripped = line.strip()

        # Check for code block delimiters
        if code_block_pattern.match(stripped):
            in_code_block = not in_code_block
            continue

        if not stripped or in_code_block:
            continue

        match = header_pattern.match(line)
        if match:
            title = match.group(2).strip()
            node_list.append({"node_title": title, "line_num": line_num})

    return node_list, lines


def extract_node_text_content(node_list: list[dict], markdown_lines: list[str]) -> list[dict]:
    """Attach text content to each node based on header positions."""
    all_nodes: list[dict] = []

    for node in node_list:
        line_content = markdown_lines[node["line_num"] - 1]
        header_match = re.match(r"^(#{1,6})", line_content)
        if header_match is None:
            logger.warning("Line %d does not contain a valid header: '%s'", node["line_num"], line_content)
            continue

        processed_node = {
            "title": node["node_title"],
            "line_num": node["line_num"],
            "level": len(header_match.group(1)),
        }
        all_nodes.append(processed_node)

    # Attach text range to each node
    for i, node in enumerate(all_nodes):
        start_line = node["line_num"] - 1
        if i + 1 < len(all_nodes):
            end_line = all_nodes[i + 1]["line_num"] - 1
        else:
            end_line = len(markdown_lines)

        node["text"] = "\n".join(markdown_lines[start_line:end_line]).strip()

    return all_nodes


def build_tree_from_nodes(node_list: list[dict]) -> list[dict]:
    """Build hierarchical tree from flat node list using stack algorithm.

    Each node has: title, level, text, and will get node_id later.
    Returns root-level nodes with nested children.
    """
    if not node_list:
        return []

    stack: list[tuple[dict, int]] = []
    root_nodes: list[dict] = []
    node_counter = 1

    for node in node_list:
        current_level = node["level"]

        tree_node: dict[str, Any] = {
            "title": node["title"],
            "node_id": str(node_counter).zfill(4),
            "text": node.get("text", ""),
            "line_num": node.get("line_num", 0),
            "nodes": [],
        }
        node_counter += 1

        # Pop stack until we find the right parent level
        while stack and stack[-1][1] >= current_level:
            stack.pop()

        if not stack:
            root_nodes.append(tree_node)
        else:
            parent_node, _ = stack[-1]
            parent_node["nodes"].append(tree_node)

        stack.append((tree_node, current_level))

    return root_nodes


def tree_thinning_for_index(
    node_list: list[dict],
    min_node_token: int | None = None,
    model: Any = None,
) -> list[dict]:
    """Merge small child nodes into their parent if below token threshold."""
    if min_node_token is None:
        return node_list

    def find_all_children(parent_index: int, parent_level: int, nodes: list[dict]) -> list[int]:
        children_indices: list[int] = []
        for i in range(parent_index + 1, len(nodes)):
            current_level = nodes[i].get("level", 0)
            if current_level <= parent_level:
                break
            children_indices.append(i)
        return children_indices

    result_list = [dict(n) for n in node_list]  # deep copy
    nodes_to_remove: set[int] = set()

    for i in range(len(result_list) - 1, -1, -1):
        if i in nodes_to_remove:
            continue

        current_node = result_list[i]
        current_level = current_node.get("level", 0)
        total_tokens = current_node.get("text_token_count", 0)

        if total_tokens < min_node_token:
            children_indices = find_all_children(i, current_level, result_list)
            children_texts: list[str] = []
            for child_index in sorted(children_indices):
                if child_index not in nodes_to_remove:
                    child_text = result_list[child_index].get("text", "")
                    if child_text.strip():
                        children_texts.append(child_text)
                    nodes_to_remove.add(child_index)

            if children_texts:
                parent_text = current_node.get("text", "")
                merged_text = parent_text
                for child_text in children_texts:
                    if merged_text and not merged_text.endswith("\n"):
                        merged_text += "\n\n"
                    merged_text += child_text

                result_list[i]["text"] = merged_text
                result_list[i]["text_token_count"] = count_tokens(merged_text, model=model)

    # Remove merged children (reverse order to preserve indices)
    for index in sorted(nodes_to_remove, reverse=True):
        result_list.pop(index)

    return result_list


def update_nodelist_with_text_token_count(node_list: list[dict], model: Any = None) -> list[dict]:
    """Calculate token count for each node including its children's text."""

    def find_all_children(parent_index: int, parent_level: int, nodes: list[dict]) -> list[int]:
        children_indices: list[int] = []
        for i in range(parent_index + 1, len(nodes)):
            current_level = nodes[i].get("level", 0)
            if current_level <= parent_level:
                break
            children_indices.append(i)
        return children_indices

    result_list = list(node_list)  # shallow copy is fine, we're only adding keys

    # Process from end to beginning so children are processed before parents
    for i in range(len(result_list) - 1, -1, -1):
        current_node = result_list[i]
        current_level = current_node.get("level", 0)

        node_text = current_node.get("text", "")
        total_text = node_text

        children_indices = find_all_children(i, current_level, result_list)
        for child_index in children_indices:
            child_text = result_list[child_index].get("text", "")
            if child_text:
                total_text += "\n" + child_text

        result_list[i]["text_token_count"] = count_tokens(total_text, model=model)

    return result_list


def clean_tree_for_output(tree_nodes: list[dict]) -> list[dict]:
    """Remove internal fields from tree nodes for clean output."""
    cleaned: list[dict] = []
    for node in tree_nodes:
        cleaned_node = {
            "title": node["title"],
            "node_id": node["node_id"],
            "line_num": node["line_num"],
        }
        if node.get("text"):
            cleaned_node["text"] = node["text"]
        if node["nodes"]:
            cleaned_node["nodes"] = clean_tree_for_output(node["nodes"])
        cleaned.append(cleaned_node)
    return cleaned


async def generate_node_summary(
    node: dict,
    model: Any = None,
    summary_token_threshold: int = 200,
) -> str:
    """Generate a summary for a node if it exceeds the token threshold."""
    node_text = node.get("text", "")
    num_tokens = count_tokens(node_text, model=model)

    if num_tokens < summary_token_threshold:
        return node_text

    prompt = generate_node_summary_prompt(node)
    try:
        if model and hasattr(model, "ainvoke"):
            from langchain_core.messages import HumanMessage

            response = await model.ainvoke([HumanMessage(content=prompt)])
            return response.content.strip() if hasattr(response, "content") else str(response)
        return node_text
    except Exception as e:
        logger.error("Failed to generate node summary: %s", e)
        return node_text


async def generate_summaries_for_structure_md(
    structure: Any,
    summary_token_threshold: int | None = None,
    model: Any = None,
) -> Any:
    """Generate summaries for all nodes in the structure in parallel."""
    nodes = structure_to_list(structure)
    summary = summary_token_threshold or 200

    tasks = [generate_node_summary(node, model=model, summary_token_threshold=summary) for node in nodes]
    summaries = await asyncio.gather(*tasks)

    for node, summary_text in zip(nodes, summaries):
        if not node.get("nodes"):
            node["summary"] = summary_text
        else:
            node["prefix_summary"] = summary_text

    return structure


async def generate_doc_description(
    structure: Any,
    model: Any = None,
) -> str:
    """Generate a one-sentence document description."""
    from deerflow.knowledge_base.pageindex_engine.utils import create_clean_structure_for_description

    clean_structure = create_clean_structure_for_description(structure)
    prompt = generate_doc_description_prompt(clean_structure)

    try:
        if model and hasattr(model, "ainvoke"):
            from langchain_core.messages import HumanMessage

            response = await model.ainvoke([HumanMessage(content=prompt)])
            return response.content.strip() if hasattr(response, "content") else str(response)
        return ""
    except Exception as e:
        logger.error("Failed to generate document description: %s", e)
        return ""


async def md_to_tree(
    md_path: str,
    if_thinning: bool = False,
    min_token_threshold: int | None = None,
    if_add_node_summary: str = "no",
    summary_token_threshold: int | None = None,
    model: Any = None,
    if_add_doc_description: str = "no",
    if_add_node_text: str = "no",
    if_add_node_id: str = "yes",
) -> dict:
    """Build a PageIndex tree from a Markdown file.

    Args:
        md_path: Path to the markdown file.
        if_thinning: Whether to merge small child nodes into parents.
        min_token_threshold: Minimum tokens per node (for thinning).
        if_add_node_summary: "yes" to generate summaries.
        summary_token_threshold: Token threshold for summary generation.
        model: LangChain chat model instance for LLM calls.
        if_add_doc_description: "yes" to generate document description.
        if_add_node_text: "yes" to include full text in tree nodes.
        if_add_node_id: "yes" to assign node IDs.

    Returns:
        Dict with doc_name, structure, and optionally doc_description.
    """
    with open(md_path, "r", encoding="utf-8") as f:
        markdown_content = f.read()

    line_count = markdown_content.count("\n") + 1

    logger.info("Extracting nodes from markdown...")
    node_list, markdown_lines = extract_nodes_from_markdown(markdown_content)

    logger.info("Extracting text content from nodes...")
    nodes_with_content = extract_node_text_content(node_list, markdown_lines)

    if if_thinning:
        nodes_with_content = update_nodelist_with_text_token_count(nodes_with_content, model=model)
        logger.info("Thinning nodes...")
        nodes_with_content = tree_thinning_for_index(
            nodes_with_content,
            min_token_threshold,
            model=model,
        )

    logger.info("Building tree from nodes...")
    tree_structure = build_tree_from_nodes(nodes_with_content)

    if if_add_node_id == "yes":
        write_node_id(tree_structure)

    logger.info("Formatting tree structure...")
    if if_add_node_summary == "yes":
        tree_structure = format_structure(
            tree_structure,
            order=["title", "node_id", "line_num", "summary", "prefix_summary", "text", "nodes"],
        )
        logger.info("Generating summaries for each node...")
        tree_structure = await generate_summaries_for_structure_md(
            tree_structure,
            summary_token_threshold=summary_token_threshold,
            model=model,
        )

        if if_add_node_text == "no":
            tree_structure = format_structure(
                tree_structure,
                order=["title", "node_id", "line_num", "summary", "prefix_summary", "nodes"],
            )

        if if_add_doc_description == "yes":
            logger.info("Generating document description...")
            from deerflow.knowledge_base.pageindex_engine.utils import create_clean_structure_for_description

            clean_structure = create_clean_structure_for_description(tree_structure)
            doc_description = await generate_doc_description(clean_structure, model=model)

            doc_name = os.path.splitext(os.path.basename(md_path))[0]
            return {
                "doc_name": doc_name,
                "doc_description": doc_description,
                "line_count": line_count,
                "structure": tree_structure,
            }
    else:
        if if_add_node_text == "yes":
            tree_structure = format_structure(
                tree_structure,
                order=["title", "node_id", "line_num", "summary", "prefix_summary", "text", "nodes"],
            )
        else:
            tree_structure = format_structure(
                tree_structure,
                order=["title", "node_id", "line_num", "summary", "prefix_summary", "nodes"],
            )

    doc_name = os.path.splitext(os.path.basename(md_path))[0]
    return {
        "doc_name": doc_name,
        "line_count": line_count,
        "structure": tree_structure,
    }
