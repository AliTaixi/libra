"""KB Context Resolver — 全文写作知识库上下文预取器。

在 LLM 调用之前，由 Python 层完成全部知识库检索和节点匹配，
把结果以纯文本形式注入生成 prompt。LLM 无工具权限，无法越界访问。

三层匹配策略:
  Level 1 — 文档级匹配：从知识库集合中选出 1 篇最契合写作项目的主文档
  Level 2 — 节点级匹配：在选定文档内，为每章选出 1 个最相关的节点
  Level 3 — 降级策略：某章无匹配时不注入 KB 内容，不影响生成
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

logger = logging.getLogger("deerflow.writing.kb_context")


class KBContextResolver:
    """知识库上下文预取器。

    用法:
        resolver = KBContextResolver(kb_service, model)
        context_map = await resolver.resolve(
            project_name="某市非遗保护工作报告",
            chapters=[{"title": "概述", "description": "..."}, ...],
            collection_id="19ed7862-...",
        )
        # context_map = {0: "节点完整正文...", 1: "", 2: "节点完整正文..."}
    """

    def __init__(self, kb_service: Any, model: Any = None) -> None:
        """
        Args:
            kb_service: KnowledgeBaseService 实例（已初始化）
            model: LangChain chat model 实例，用于匹配阶段的 LLM 调用（轻量）
                   如果为 None 则只做降级的关键词匹配
        """
        self._kb = kb_service
        self._model = model

    async def resolve(
        self,
        project_name: str,
        chapters: list[dict],
        collection_id: str | None,
    ) -> dict[int, str]:
        """预取每章对应的 KB 上下文。

        Args:
            project_name: 写作项目名称（如 "某市非遗保护工作报告"）
            chapters: 章节列表，每项含 title、description（可选）
            collection_id: 用户选定的知识库集合 ID（None 则不检索）

        Returns:
            {章节索引: KB 上下文文本}，无匹配的章节索引不会出现在结果中
        """
        if not collection_id or not self._kb:
            return {}

        # ── Step 1: 列出集合中已索引的文档 ──────────────────────
        try:
            docs = await self._kb.list_documents(collection_id, status="ready")
        except Exception as e:
            logger.warning("KB list_documents 失败: %s", e)
            return {}

        if not docs:
            logger.info("知识库集合 %s 中没有已索引的文档", collection_id)
            return {}

        # ── Step 2: 文档级匹配（选 1 篇主文档） ──────────────────
        selected = await self._match_document(project_name, chapters, docs)
        if not selected:
            logger.info("未能从 %d 篇文档中选出主文档", len(docs))
            return {}

        doc_id = selected["id"]
        logger.info("选中主文档: %s (%s)", selected.get("title", ""), doc_id)

        # ── Step 3: 获取文档的树结构（无正文，仅标题+摘要） ──────
        try:
            tree = await self._kb.get_tree_structure_only(doc_id)
        except Exception as e:
            logger.warning("获取文档树结构失败: %s", e)
            return {}

        if not tree:
            return {}
        structure = tree.get("structure", [])

        # ── Step 4: 为每章匹配最佳节点（并行） ───────────────────
        async def _match_one(idx: int, ch: dict) -> tuple[int, str | None]:
            node_id = await self._match_node(
                chapter_title=ch.get("title", ""),
                chapter_description=ch.get("description", ""),
                structure=structure,
            )
            return idx, node_id

        matches = await asyncio.gather(*[
            _match_one(idx, ch) for idx, ch in enumerate(chapters)
        ])

        # ── Step 5: 提取匹配节点的完整正文（并行） ────────────────
        async def _fetch_one(idx: int, node_id: str | None) -> tuple[int, str]:
            if not node_id:
                return idx, ""
            try:
                content = await self._kb._extract_node_content(doc_id, [node_id])
                return idx, content or ""
            except Exception as e:
                logger.warning("提取节点 %s 内容失败: %s", node_id, e)
                return idx, ""

        results = await asyncio.gather(*[
            _fetch_one(idx, nid) for idx, nid in matches if nid
        ])

        context_map = {idx: text for idx, text in results if text}
        logger.info(
            "KB 预取完成: %d 章中 %d 章有匹配",
            len(chapters), len(context_map),
        )
        return context_map

    # ── Level 1: 文档匹配 ─────────────────────────────────────────────

    async def _match_document(
        self,
        project_name: str,
        chapters: list[dict],
        docs: list[dict],
    ) -> dict | None:
        """从文档列表中选出最契合写作项目的 1 篇主文档。

        展示每篇文档的 title + doc_description（索引时已由 LLM 生成），
        让 LLM 选出领域最匹配的一篇。
        """
        # 构建文档目录（轻量：只传标题+描述）
        doc_lines = []
        for d in docs:
            title = d.get("title", "")
            desc = d.get("doc_description", "")
            if title:
                doc_lines.append(f"- {title}")
                if desc:
                    doc_lines.append(f"  {desc[:200]}")
        doc_table = "\n".join(doc_lines)

        # 章节列表简要
        ch_titles = "\n".join(
            f"- {ch.get('title', '')}" for ch in chapters if ch.get("title")
        )

        prompt = (
            "你是一个文档分析专家。有一个写作项目，需要从知识库中选出"
            "1 篇最合适的参考文档。\n\n"
            f"写作项目：{project_name}\n\n"
            "写作章节：\n"
            f"{ch_titles}\n\n"
            "知识库有以下文档：\n"
            f"{doc_table}\n\n"
            "请选出最契合写作项目主题的 ONE 篇文档。\n"
            "只返回文档标题，不要解释。"
        )

        doc_id = await self._llm_select_one(
            prompt=prompt,
            candidates={d.get("title", ""): d["id"] for d in docs if d.get("id")},
        )
        if doc_id:
            return next((d for d in docs if d["id"] == doc_id), None)
        return None

    # ── Level 2: 节点匹配 ─────────────────────────────────────────────

    async def _match_node(
        self,
        chapter_title: str,
        chapter_description: str,
        structure: list[dict],
    ) -> str | None:
        """从文档的树结构中选出最匹配本章的 1 个节点，返回 node_id。

        展示节点的 title + summary（索引时已由 LLM 生成），
        让 LLM 选出语义最相关的一个。
        """
        if not structure:
            return None

        # 构建节点目录
        from deerflow.knowledge_base.pageindex_engine.utils import (
            structure_to_list,
        )

        all_nodes = structure_to_list(structure)
        if not all_nodes:
            return None

        node_lines = []
        for n in all_nodes:
            nid = n.get("node_id", "")
            title = n.get("title", "")
            summary = n.get("summary") or n.get("prefix_summary", "") or ""
            summary_short = summary[:200] if len(summary) > 200 else summary
            if title and nid:
                node_lines.append(
                    f'["{nid}"] {title}'
                    + (f" — {summary_short}" if summary_short else "")
                )

        node_table = "\n".join(node_lines)

        desc_info = f"\n章节说明：{chapter_description}" if chapter_description else ""
        prompt = (
            "你是文档检索专家。写作章节如下，请从文档目录中选出"
            "最相关的一段作为参考。\n\n"
            f"写作章节：{chapter_title}{desc_info}\n\n"
            "文档目录（[节点ID] 标题 — 摘要）：\n"
            f"{node_table}\n\n"
            "只返回 1 个最相关的 [节点ID]，不要解释。\n"
            "格式：0000"
        )

        return await self._llm_select_one(
            prompt=prompt,
            candidates={n.get("node_id", ""): n.get("node_id", "")
                        for n in all_nodes if n.get("node_id")},
        )

    # ── LLM 辅助 ───────────────────────────────────────────────────────

    async def _llm_select_one(
        self,
        prompt: str,
        candidates: dict[str, str],
    ) -> str | None:
        """通用 LLM 单选：给 prompt，从候选中选出 1 个。

        返回选中候选项的 key（如果 LLM 输出在候选项中）。
        无模型或 LLM 返回无效内容时回退到空。
        """
        if not candidates:
            return None

        # 如果有模型，用 LLM 匹配
        if self._model is not None:
            try:
                from langchain_core.messages import HumanMessage

                response = await self._model.ainvoke(
                    [HumanMessage(content=prompt)]
                )
                answer = (
                    response.content.strip()
                    if hasattr(response, "content")
                    else str(response).strip()
                )

                # 尝试精确匹配
                for key, val in candidates.items():
                    if key and (key in answer or answer in key):
                        return val

                # 尝试模糊匹配（取第一个在 answer 中出现的候选）
                for key, val in candidates.items():
                    if key and key in answer:
                        return val

                logger.debug(
                    "LLM 返回无法匹配: %s, 候选: %s",
                    answer[:100], list(candidates.keys()),
                )
            except Exception as e:
                logger.warning("LLM 选择失败: %s", e)

        # 无模型或 LLM 失败 → 关键词降级
        return self._keyword_select(prompt, candidates)

    def _keyword_select(
        self,
        query: str,
        candidates: dict[str, str],
    ) -> str | None:
        """关键词降级匹配。"""
        query_lower = query.lower()
        keywords = set(query_lower.split())

        best_score = 0
        best_key = None
        for key in candidates:
            key_lower = key.lower()
            score = sum(1 for kw in keywords if kw in key_lower)
            # 整句匹配加分
            if query_lower in key_lower:
                score += 10
            if score > best_score:
                best_score = score
                best_key = key

        if best_key and best_score > 0:
            return candidates[best_key]
        return None
