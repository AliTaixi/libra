"""DeerFlow Writing Service — 全文写作核心业务逻辑层。

与 knowledge_base 对齐，将 AI 内容生成、图表渲染、导出等业务逻辑
下沉到 harness 层，供 routes / agent tools 等多入口复用。
"""

from deerflow.writing.kb_context import KBContextResolver

__all__ = ["KBContextResolver"]
