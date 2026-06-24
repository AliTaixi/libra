"""Query Pipeline — Convenience wrapper for the full KB query flow.

Re-exports the core query functions from service.py for a cleaner API.
"""

from deerflow.knowledge_base.service import KnowledgeBaseService
from deerflow.knowledge_base.tree_search import tree_search_pipeline

__all__ = [
    "KnowledgeBaseService",
    "tree_search_pipeline",
]
