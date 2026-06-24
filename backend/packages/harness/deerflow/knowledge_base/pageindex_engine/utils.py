"""Utility functions adapted from PageIndex for DeerFlow.

Replaces litellm calls with langchain model instances configured via DeerFlow.
"""

from __future__ import annotations

import copy
import json
import logging
import re
from io import BytesIO
from typing import Any

logger = logging.getLogger(__name__)


def count_tokens(text: str, model: Any = None) -> int:
    """Count tokens in text using a model's tokenizer or simple heuristic."""
    if not text:
        return 0
    if model and hasattr(model, "get_num_tokens"):
        try:
            return model.get_num_tokens(text)
        except Exception:
            pass
    # Fallback: approximate with 4 chars per token
    return len(text) // 4


def extract_json(content: str) -> dict[str, Any] | list[Any]:
    """Extract JSON object from LLM response text, handling markdown fences."""
    try:
        # Try to extract JSON enclosed in ```json and ```
        start_idx = content.find("```json")
        if start_idx != -1:
            start_idx += 7  # skip past ```json
            end_idx = content.find("```", start_idx)
            json_content = content[start_idx:end_idx].strip() if end_idx != -1 else content[start_idx:].strip()
        else:
            # Fallback: try to find {...} or [...] directly
            json_content = content.strip()

        # Clean up common issues
        json_content = json_content.replace("None", "null").replace("'", '"')
        # Remove trailing commas before closing brackets/braces
        json_content = re.sub(r",\s*([}\]])", r"\1", json_content)

        return json.loads(json_content)
    except json.JSONDecodeError as e:
        logger.error("Failed to extract JSON: %s", e)
        logger.debug("Raw content: %s", content[:500])
        # Last resort: try to find anything that looks like JSON
        try:
            brace_start = content.find("{")
            brace_end = content.rfind("}")
            if brace_start != -1 and brace_end > brace_start:
                return json.loads(content[brace_start : brace_end + 1])
            bracket_start = content.find("[")
            bracket_end = content.rfind("]")
            if bracket_start != -1 and bracket_end > bracket_start:
                return json.loads(content[bracket_start : bracket_end + 1])
        except (json.JSONDecodeError, ValueError):
            pass
        return {}


def write_node_id(data: Any, node_id: int = 0) -> int:
    """Assign zero-padded 4-digit node_id to all nodes in the tree."""
    if isinstance(data, dict):
        data["node_id"] = str(node_id).zfill(4)
        node_id += 1
        for key in list(data.keys()):
            if "nodes" in key:
                node_id = write_node_id(data[key], node_id)
    elif isinstance(data, list):
        for index in range(len(data)):
            node_id = write_node_id(data[index], node_id)
    return node_id


def structure_to_list(structure: Any) -> list[dict]:
    """Flatten a tree structure into a list of all nodes."""
    nodes: list[dict] = []
    if isinstance(structure, dict):
        nodes.append(structure)
        if "nodes" in structure:
            nodes.extend(structure_to_list(structure["nodes"]))
    elif isinstance(structure, list):
        for item in structure:
            nodes.extend(structure_to_list(item))
    return nodes


def get_nodes(structure: Any) -> list[dict]:
    """Deep copy structure and return flat list of nodes without children."""
    if isinstance(structure, dict):
        structure_node = copy.deepcopy(structure)
        structure_node.pop("nodes", None)
        nodes = [structure_node]
        for key in list(structure.keys()):
            if "nodes" in key:
                nodes.extend(get_nodes(structure[key]))
        return nodes
    elif isinstance(structure, list):
        nodes = []
        for item in structure:
            nodes.extend(get_nodes(item))
        return nodes
    return []


def get_leaf_nodes(structure: Any) -> list[dict]:
    """Get only leaf nodes (nodes without children)."""
    if isinstance(structure, dict):
        if not structure.get("nodes"):
            structure_node = copy.deepcopy(structure)
            structure_node.pop("nodes", None)
            return [structure_node]
        else:
            leaf_nodes = []
            for key in list(structure.keys()):
                if "nodes" in key:
                    leaf_nodes.extend(get_leaf_nodes(structure[key]))
            return leaf_nodes
    elif isinstance(structure, list):
        leaf_nodes = []
        for item in structure:
            leaf_nodes.extend(get_leaf_nodes(item))
        return leaf_nodes
    return []


def reorder_dict(data: dict, key_order: list[str] | None) -> dict:
    """Reorder dictionary keys according to key_order."""
    if not key_order:
        return data
    return {key: data[key] for key in key_order if key in data}


def format_structure(structure: Any, order: list[str] | None = None) -> Any:
    """Recursively format tree structure with consistent key ordering."""
    if not order:
        return structure
    if isinstance(structure, dict):
        if "nodes" in structure:
            structure["nodes"] = format_structure(structure["nodes"], order)
        if not structure.get("nodes"):
            structure.pop("nodes", None)
        structure = reorder_dict(structure, order)
    elif isinstance(structure, list):
        structure = [format_structure(item, order) for item in structure]
    return structure


def remove_structure_text(data: Any) -> Any:
    """Remove 'text' fields from tree structure (for display/saving tokens)."""
    if isinstance(data, dict):
        data.pop("text", None)
        if "nodes" in data:
            remove_structure_text(data["nodes"])
    elif isinstance(data, list):
        for item in data:
            remove_structure_text(item)
    return data


def create_clean_structure_for_description(structure: Any) -> Any:
    """Create a clean structure for document description generation (without text)."""
    if isinstance(data := structure, dict):
        clean_node: dict[str, Any] = {}
        for key in ["title", "node_id", "summary", "prefix_summary"]:
            if key in data:
                clean_node[key] = data[key]
        if "nodes" in data and data["nodes"]:
            clean_node["nodes"] = create_clean_structure_for_description(data["nodes"])
        return clean_node
    elif isinstance(structure, list):
        return [create_clean_structure_for_description(item) for item in structure]
    return structure


def create_node_mapping(tree: list[dict]) -> dict[str, dict]:
    """Create a flat dict mapping node_id to node for quick lookup."""
    mapping: dict[str, dict] = {}

    def _traverse(nodes: list[dict]) -> None:
        for node in nodes:
            if node.get("node_id"):
                mapping[node["node_id"]] = node
            if node.get("nodes"):
                _traverse(node["nodes"])

    _traverse(tree)
    return mapping


def print_tree(tree: list[dict], indent: int = 0) -> None:
    """Print tree structure in human-readable format (for debugging)."""
    for node in tree:
        summary = node.get("summary") or node.get("prefix_summary", "")
        summary_str = f"  — {summary[:60]}..." if summary else ""
        print(f"{'  ' * indent}[{node.get('node_id', '?')}] {node.get('title', '')}{summary_str}")
        if node.get("nodes"):
            print_tree(node["nodes"], indent + 1)


def generate_node_summary_prompt(node: dict) -> str:
    """Generate the prompt for creating a node summary."""
    return f"""You are given a part of a document. Your task is to generate a concise description of what main points are covered in this partial document.

Partial Document Text:
{node.get('text', '')}

Directly return the description, do not include any other text."""


def generate_doc_description_prompt(structure: Any) -> str:
    """Generate the prompt for creating a document description."""
    structure_json = json.dumps(structure, ensure_ascii=False, indent=2)
    return f"""You are an expert in generating descriptions for a document. You are given a structure of a document. Your task is to generate a one-sentence description for the document, which makes it easy to distinguish the document from other documents.

Document Structure:
{structure_json}

Directly return the description, do not include any other text."""
