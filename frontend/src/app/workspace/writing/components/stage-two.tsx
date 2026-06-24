"use client";

import { useCallback, useState, useRef, useEffect } from "react";
import { ChevronRight, BarChart3, GitFork, Table2, Send, Loader2, Sparkles, Pencil, RefreshCw, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWritingState, useWritingDispatch, useSaveDraft } from "../store/writing-store";
import dynamic from "next/dynamic";
import { type WangEditorHandle } from "./wang-editor";
import { EditorErrorBoundary } from "./editor-error-boundary";

const WangEditor = dynamic(() => import("./wang-editor").then(m => m.WangEditor), { ssr: false });
import { generateChartFromText, generateDiagramFromText, generateContent, reviseContent, aiGenerateVisual, updateDraft, generateTableFromText } from "@/core/writing/api";
import { toast } from "sonner";
import { useI18n } from "@/core/i18n/hooks";

// ── Markdown → HTML 转换工具函数 ──────────────────────────────────────────

function mdInline(text: string): string {
  return text
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/~~(.+?)~~/g, "<s>$1</s>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />');
}

function isTableSeparator(line: string): boolean {
  return /^[:\-\s|]+$/.test(line.replace(/^\|/, "").replace(/\|$/, ""));
}

function mdToHtml(text: string): string {
  return text.split("\n").map((raw) => {
    const line = raw.trim();
    if (!line) return "";

    // 表格行（统一处理：首尾| 或 含2+个| 的均为表格）
    const pipeCount = (line.match(/\|/g) || []).length;
    const isTableRow = (line.startsWith("|") && line.endsWith("|")) || pipeCount >= 2;
    if (isTableRow) {
      if (isTableSeparator(line)) return "";
      const cells = line.split("|").map((s) => s.trim()).filter(Boolean);
      if (cells.length === 0) return "";
      return `<p>${cells.join(" | ")}</p>`;
    }

    // 列表项
    const listMatch = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)/);
    if (listMatch) {
      return `<li>${mdInline(listMatch[3])}</li>`;
    }

    // 标题
    const heading = line.match(/^(#{1,4})\s+(.*)/);
    if (heading) {
      return `<h${heading[1].length}>${mdInline(heading[2])}</h${heading[1].length}>`;
    }

    return `<p>${mdInline(line)}</p>`;
  }).filter(Boolean).join("\n");
}

/** 判断章节内容是否为"有效空"（空字符串、纯空白、或只有占位符） */
function isContentEffectivelyEmpty(content: string | undefined): boolean {
  if (!content || !content.trim()) return true;
  if (content.includes("本节内容待撰写")) return true;
  if (content.includes("待撰写")) return true;
  // 如果没有 <p> 标签，说明没有任何正文段落，视为空
  if (!content.includes("<p>")) return true;
  return false;
}

const CHART_TYPES = [
  { value: "bar", label: "柱状图", tool: "1" },
  { value: "line", label: "折线图", tool: "1" },
  { value: "pie", label: "饼图", tool: "1" },
  { value: "scatter", label: "散点图", tool: "1" },
  { value: "box", label: "箱线图", tool: "2" },
  { value: "violin", label: "小提琴图", tool: "2" },
  { value: "heatmap", label: "热力图", tool: "2" },
];

const DIAGRAM_TYPES = [
  { value: "graph TD", label: "流程图" },
  { value: "sequenceDiagram", label: "时序图" },
  { value: "classDiagram", label: "类图" },
  { value: "stateDiagram-v2", label: "状态图" },
  { value: "erDiagram", label: "ER 图" },
  { value: "gantt", label: "甘特图" },
  { value: "journey", label: "用户旅程" },

  { value: "timeline", label: "时间线" },
  { value: "C4Context", label: "C4 架构图" },
  { value: "architecture-beta", label: "系统架构图" },
  { value: "kanban", label: "看板" },
  { value: "ishikawa", label: "石川图" },
];

export function StageTwo() {
  const { t } = useI18n();
  const state = useWritingState();
  const dispatch = useWritingDispatch();
  const editorRef = useRef<WangEditorHandle>(null);

  const saveDraft = useSaveDraft();

  const currentChapter = state.chapters[state.currentChapterIndex];
  const isAnyGenerating = state.generatingIndex >= 0;
  const allGenerated = state.chapters.every((ch) => !isContentEffectivelyEmpty(ch.content));

  // ── 强制内容同步：store 有数据而编辑器未同步时推入 ────────────
  const [syncing, setSyncing] = useState(false);
  const lastStoreContentRef = useRef("");

  const syncContentToEditor = useCallback((content: string) => {
    const ed = editorRef.current?.getEditor();
    if (!ed) return false;
    try {
      // 确保内容有 HTML 包裹，防止 Slate 纯文本崩溃
      const html = content && !/<[a-z]/i.test(content) ? `<p>${content}</p>` : content || "";
      lastStoreContentRef.current = html;
      ed.setHtml(html);
      return true;
    } catch {
      return false;
    }
  }, []);

  // 内容变化时推入编辑器；若编辑器未就绪则轮询等待
  useEffect(() => {
    const storeContent = currentChapter?.content || "";
    if (!storeContent || storeContent === lastStoreContentRef.current) return;

    if (syncContentToEditor(storeContent)) {
      setSyncing(false);
      return;
    }
    // 编辑器还没就绪 → 标记等待 + 轮询
    setSyncing(true);
    const timer = setInterval(() => {
      if (syncContentToEditor(storeContent)) {
        setSyncing(false);
        clearInterval(timer);
      }
    }, 200);
    return () => clearInterval(timer);
  }, [currentChapter?.content]);

  // ── 并发 AI 生成（所有章节同时发给大模型）─────────────────────────
  const generateAllChapters = useCallback(async () => {
    const descFile = state.files.find((f) => f.type === "description");
    const chapters = state.chapters;
    const projectName = state.projectName;

    // 构造所有章节的请求
    const CONCURRENCY = 4;
    let successCount = 0;
    let failCount = 0;
    let nextChapterIdx = 0;
    const toHtml = (c: string) => mdToHtml(c);

    // 处理单个章节
    const processOne = async (idx: number) => {
      const ch = chapters[idx];
      const chStruct = ch as { structure?: Array<{ level: number; title: string; children?: Array<{ level: number; title: string }> }> };
      const chBody = ch as { bodyText?: string };
      const ctx = chBody.bodyText
        ? `以下是模板中该章节的占位正文，请参考其格式生成正式内容：\n${chBody.bodyText.slice(0, 2000)}`
        : "";
      // 加入随机种子避免每次生成相同内容
      const seed = Date.now() + "-" + Math.random().toString(36).slice(2, 8);
      const apiPromise = generateContent({
        chapter_title: ch.title,
        chapter_description: `第${idx + 1}章 (${seed})`,
        project_name: projectName,
        doc_type: state.docType,
        context: [ctx, descFile ? `对象说明文件已上传，请参考其内容撰写：${descFile.name}` : ""].filter(Boolean).join("\n"),
        word_count: 500,
        structure: chStruct.structure || [],
        model_name: state.modelName || undefined,
      });
      // 3分钟超时
      const timeout = new Promise((_, r) => setTimeout(() => r(new Error("timeout")), 180000));
      const result = await Promise.race([apiPromise, timeout]);
      return { idx, resp: result };
    };

    // 队列调度：维持 CONCURRENCY 个并发，完成一个立即入队下一个
    const worker = async () => {
      while (nextChapterIdx < chapters.length) {
        const idx = nextChapterIdx++;
        try {
          const { idx: i, resp } = await processOne(idx);
          if ((resp as any)?.success && (resp as any)?.content) {
            dispatch({ type: "UPDATE_CHAPTER_CONTENT", payload: { index: i, content: toHtml((resp as any).content) } });
            successCount++;
          } else {
            failCount++;
          }
        } catch (e: any) {
          console.error(`第${idx + 1}章生成失败:`, e);
          failCount++;
        }
      }
    };

    // 启动 CONCURRENCY 个 worker
    const workers: Promise<void>[] = [];
    for (let i = 0; i < CONCURRENCY; i++) {
      workers.push(worker());
    }
    await Promise.allSettled(workers);

    dispatch({ type: "SET_GENERATING_INDEX", payload: -1 });
    if (failCount === 0) toast.success(`全部 ${successCount} 章内容已生成`);
    else if (successCount > 0) toast.info(`完成 ${successCount} 章，${failCount} 章失败`);
    else toast.error("生成失败，请检查 Ollama 服务后重试");
  }, [state.chapters, state.files, state.projectName, state.docType, dispatch]);

  // 进入写作阶段时启动逐章生成（仅当无 draftId 时，旧前端直连模式）
  // 有 draftId 时由后端 SSE 驱动生成，前端不参与
  useEffect(() => {
    if (state.draftId) return; // SSE 模式跳过
    if (state.generatingIndex === -1 && state.chapters.length > 0) {
      dispatch({ type: "SET_GENERATING_INDEX", payload: 0 });
    }
  }, [state.draftId, state.generatingIndex, state.chapters.length, dispatch]);

  // generatingIndex 变化时触发生成（仅前端直连模式，有 draftId 时跳过）
  const generationStarted = useRef(false);
  useEffect(() => {
    if (state.draftId) return; // SSE 模式跳过
    if (state.generatingIndex === 0 && state.chapters.length > 0 && !generationStarted.current) {
      generationStarted.current = true;
      console.log("[写作] 开始批量生成", state.chapters.length, "章");
      generateAllChapters().catch(e => {
        console.error("[写作] 生成异常:", e);
      }).finally(() => {
        dispatch({ type: "SET_GENERATING_INDEX", payload: -1 });
      });
      // 安全兜底：5分钟强制完成
      setTimeout(() => {
        if (state.generatingIndex === 0) {
          console.warn("[写作] 生成超时，强制完成");
          dispatch({ type: "SET_GENERATING_INDEX", payload: -1 });
        }
      }, 300000);
    }
  }, [state.draftId, state.generatingIndex, state.chapters.length, dispatch]);

  // ── 左侧面板点击时不丢失编辑器选中 ────────────────────────────
  useEffect(() => {
    const leftPanel = document.querySelector('[data-writing-left-panel]');
    if (!leftPanel) return;
    const onMouseDown = () => {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        // 只在编辑器内的选中才保存
        const editorContainer = document.querySelector('.w-e-text-container');
        if (editorContainer && editorContainer.contains(range.commonAncestorContainer)) {
          (window as any).__writingSavedRange = range.cloneRange();
          (window as any).__writingPreserveSelection = true;
          // 标记左侧面板活跃，通知 WangEditor 拦截键盘事件
          (window as any).__writingLeftPanelActive = true;
        }
      }
    };
    leftPanel.addEventListener('mousedown', onMouseDown);
    return () => {
      (window as any).__writingLeftPanelActive = false;
      leftPanel.removeEventListener('mousedown', onMouseDown);
    };
  }, []);

  // 用 ref 存当前章节索引，确保编辑时的回调始终写入正确的章节
  const chapterIndexRef = useRef(state.currentChapterIndex);
  chapterIndexRef.current = state.currentChapterIndex;

  const handleContentChange = useCallback(
    (html: string, chapterKey?: string | number) => {
      // 保护：用 ref（而非 state）校验来源章节，防止章节切换时旧闭包中的 state 值与实际索引不一致
      // 说明：render 阶段 chapterIndexRef.current 已被更新，
      //   而旧闭包的 state.currentChapterIndex 还是旧值，会导致校验误判通过。
      const actualIdx = chapterIndexRef.current;
      if (chapterKey !== undefined && chapterKey !== actualIdx) {
        console.log("[写入章节] 忽略来自已卸载编辑器的内容更新", { chapterKey, current: actualIdx });
        return;
      }
      console.log(`[写入章节] index=${actualIdx} len=${html.length} preview="${html.slice(0, 60).replace(/\n/g, ' ')}"`);
      dispatch({ type: "UPDATE_CHAPTER_CONTENT", payload: { index: actualIdx, content: html } });
    },
    [dispatch],
  );

  // 跟踪正在处理中的章节（修改、图表等操作期间锁定，触发重渲染）
  const [processingChapters, setProcessingChapters] = useState<Set<number>>(new Set());
  const isChapterBusy = processingChapters.has(state.currentChapterIndex);
  const markProcessing = useCallback((idx: number, busy: boolean) => {
    setProcessingChapters(prev => { const n = new Set(prev); if (busy) n.add(idx); else n.delete(idx); return n; });
  }, []);

  /** 获取选中的文字：优先编辑器当前选中，失焦时用最后保存的选中 */
  const getSelectedText = useCallback(() => {
    const editor = editorRef.current?.getEditor();
    if (editor) {
      const text = editor.getSelectionText();
      if (text) return text;
    }
    return editorRef.current?.getLastSelection()?.text || "";
  }, []);

  // ── 响应式选中文字追踪 ────────────────────────────────────────────
  const [selectedText, setSelectedText] = useState("");
  const selectedTextRef = useRef("");
  const selectedLen = selectedText.length;

  useEffect(() => {
    const handleSelectionChange = () => {
      const text = getSelectedText();
      if (text !== selectedTextRef.current) {
        selectedTextRef.current = text;
        setSelectedText(text);
      }
    };
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => document.removeEventListener("selectionchange", handleSelectionChange);
  }, [getSelectedText]);

  const handleClearSelection = useCallback(() => {
    selectedTextRef.current = "";
    setSelectedText("");
    // 清除任何保存的范围和编辑器选中
    document.getElementById("wang-selection-overlay")?.remove();
    (window as any).__writingSavedRange = null;
  }, []);

  const [chartType, setChartType] = useState("bar");
  const [chartLoading, setChartLoading] = useState(false);
  const [diagramType, setDiagramType] = useState("graph TD");
  const [diagramLoading, setDiagramLoading] = useState(false);
  const [tableLoading, setTableLoading] = useState(false);

  const handleGenerateChart = useCallback(async () => {
    const selText = getSelectedText();
    if (!selText) return;
    setChartLoading(true);
    markProcessing(state.currentChapterIndex, true);
    try {
      const result = await generateChartFromText({
        text: selText,
        chart_type: chartType,
      });
      if (result.success && result.svg_content && isValidSvg(result.svg_content)) {
        const label = CHART_TYPES.find(c => c.value === chartType)?.label || chartType;
        const imgSrc = svgToDataUri(result.svg_content);
        const imgTag = `\n<figure style="margin:1em 0;text-align:center;"><img src="${imgSrc}" alt="${label}" style="max-width:100%;height:auto;display:inline-block;" /><figcaption style="text-align:center;font-size:0.85rem;color:#666;margin-top:0.3em;">图：${label}</figcaption></figure>\n`;
        // 在选中文字之后插入，不删除原文
        editorRef.current?.insertAfterSelection(imgTag);
        dispatch({ type: "CLEAR_SELECTION" });
        toast.success(`已生成${label}`);
      } else {
        const snippet = result.svg_content?.slice(0, 100).replace(/\s+/g, " ") || "空";
        toast.error(`图表生成失败，返回内容不是有效 SVG (${snippet}...)`);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "图表生成失败";
      toast.error(msg);
    } finally {
      setChartLoading(false);
      markProcessing(state.currentChapterIndex, false);
    }
  }, [state.selectedText, chartType, state.currentChapterIndex]);

/** 校验返回内容是否为有效 SVG */
const isValidSvg = (content: string): boolean => {
    const trimmed = content.trim();
    return trimmed.startsWith("<svg") || trimmed.startsWith("<?xml") || trimmed.includes("<svg ");
  };

/** 将 SVG 内容转为 base64 data URI，以 <img> 形式嵌入编辑器（避免 wangEditor 过滤 SVG 标签） */
function svgToDataUri(svgContent: string): string {
    // 提取 <svg> 部分（去掉 <?xml?> 和 DOCTYPE，避免 HTML 上下文解析异常）
    const svgMatch = svgContent.match(/<svg[\s\S]*<\/svg>/i);
    const cleanSvg = svgMatch ? svgMatch[0] : svgContent;
    // TextEncoder → base64（支持中文等非 Latin-1 字符）
    const bytes = new TextEncoder().encode(cleanSvg);
    const binStr = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
    return `data:image/svg+xml;base64,${btoa(binStr)}`;
  }

  const handleGenerateDiagram = useCallback(async () => {
    const selText = getSelectedText();
    if (!selText) return;
    setDiagramLoading(true);
    try {
      const result = await generateDiagramFromText({
        text: selText,
        diagram_type: diagramType,
      });
      // 后端返回 PNG data URI（data:image/png;base64,...），
      // 与 diagram-code-generation skill 使用完全相同的渲染路径
      const isDataUri = result.svg_content?.startsWith("data:image/");
      if (result.success && result.svg_content && (isDataUri || isValidSvg(result.svg_content))) {
        const label = DIAGRAM_TYPES.find(d => d.value === diagramType)?.label || "框架图";
        const imgSrc = isDataUri ? result.svg_content : svgToDataUri(result.svg_content);
        const imgTag = `\n<figure style="margin:1em 0;text-align:center;"><img src="${imgSrc}" alt="${label}" style="max-width:100%;height:auto;display:inline-block;" /><figcaption style="text-align:center;font-size:0.85rem;color:#666;margin-top:0.3em;">图：${label}</figcaption></figure>\n`;
        // 在选中文字之后插入，不删除原文
        editorRef.current?.insertAfterSelection(imgTag);
        dispatch({ type: "CLEAR_SELECTION" });
        toast.success(`已生成${label}`);
      } else {
        const snippet = result.svg_content?.slice(0, 100).replace(/\s+/g, " ") || "空";
        toast.error(`框架图生成失败，返回内容不是有效图片 (${snippet}...)`);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "框架图生成失败";
      toast.error(msg);
    } finally {
      setDiagramLoading(false);
    }
  }, [state.selectedText, state.currentChapterIndex, diagramType]);

  const handleAiVisual = useCallback(async () => {
    const selText = getSelectedText();
    if (!selText) return;
    setAiVisualLoading(true);
    try {
      const resp = await aiGenerateVisual({ text: selText });
      if (resp.success && resp.content) {
        let insertHtml = "";
        if (resp.content_type === "svg") {
          const imgSrc = svgToDataUri(resp.content);
          insertHtml = `\n<figure style="margin:1em 0;text-align:center;"><img src="${imgSrc}" alt="${resp.caption || "AI 生成"}" style="max-width:100%;height:auto;display:inline-block;" /><figcaption style="text-align:center;font-size:0.85rem;color:#666;margin-top:0.3em;">${resp.caption || "AI 生成"}</figcaption></figure>\n`;
        } else {
          insertHtml = `\n${resp.content}\n`;
        }
        // 在选中文字之后插入，不删除原文
        editorRef.current?.insertAfterSelection(insertHtml);
        dispatch({ type: "CLEAR_SELECTION" });
        toast.success(`已生成${resp.caption || "可视化内容"}`);
      } else {
        toast.error("AI 生成失败，请重试");
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "请求失败";
      toast.error(msg);
    } finally {
      setAiVisualLoading(false);
    }
  }, [state.selectedText, state.currentChapterIndex, dispatch]);

  const handleGenerateTable = useCallback(async () => {
    const selText = getSelectedText();
    if (!selText) return;
    // 清除视觉高亮（直接 DOM 操作，无需跨组件导出）
    document.getElementById("wang-selection-overlay")?.remove();
    setTableLoading(true);
    try {
      const result = await generateTableFromText({
        text: selText,
        model_name: state.modelName || undefined,
      });
      if (result.success && result.table_html) {
        // 在选中文字之后插入 AI 生成的表格 HTML
        editorRef.current?.insertAfterSelection("\n" + result.table_html + "\n");
        dispatch({ type: "CLEAR_SELECTION" });
        toast.success(`表格已生成: ${result.caption || "数据表格"}`);
      } else {
        toast.warning("AI 未能生成表格，请尝试选择更结构化的文字");
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "表格生成失败";
      toast.error(msg);
    } finally {
      setTableLoading(false);
    }
  }, [state.selectedText, state.currentChapterIndex, state.modelName]);

  // ── 单章重试 ────────────────────────────────────────────────
  const [retryingIndex, setRetryingIndex] = useState<number | null>(null);
  const handleRetryChapter = useCallback(async (idx: number) => {
    const ch = state.chapters[idx];
    if (!ch) return;
    setRetryingIndex(idx);
    if (state.draftId) {
      // SSE 模式：重置该章节 content + 标记为待生成，让 SSE 重新连接
      try {
        const updatedChapters = state.chapters.map((c, i) =>
          i === idx ? { ...c, content: "" } : c
        );
        const gs = state.generationState;
        await updateDraft(state.draftId, {
          chapters: updatedChapters as unknown[],
          generation_state: {
            ...gs,
            status: "generating",
            pending_chapters: [...(gs.pending_chapters || []), idx],
            failed_chapters: (gs.failed_chapters || []).filter((i: number) => i !== idx),
            last_error: "",
          },
        });
        dispatch({ type: "SET_CHAPTERS", payload: updatedChapters });
        dispatch({
          type: "SET_GENERATION_STATE",
          payload: {
            status: "generating",
            pending_chapters: [...(gs.pending_chapters || []), idx],
            failed_chapters: (gs.failed_chapters || []).filter((i: number) => i !== idx),
            generated_chapters: gs.generated_chapters || [],
            last_error: "",
          },
        });
        toast.info(`已重新提交「${ch.title}」生成请求`);
      } catch (e: unknown) {
        toast.error("重试失败，请稍后再试");
      }
    } else {
      // 前端直连模式：直接调用 API 生成该章节
      try {
        const resp = await generateContent({
          chapter_title: ch.title,
          chapter_description: `第${idx + 1}章 (重试)`,
          project_name: state.projectName,
          doc_type: state.docType,
          structure: (ch as { structure?: unknown[] }).structure || [],
          model_name: state.modelName || undefined,
        });
        if ((resp as any)?.success && (resp as any)?.content) {
          dispatch({
            type: "UPDATE_CHAPTER_CONTENT",
            payload: { index: idx, content: mdToHtml((resp as any).content) },
          });
          toast.success(`「${ch.title}」已重新生成`);
        } else {
          toast.error("重试生成失败");
        }
      } catch (e: unknown) {
        toast.error("重试请求失败");
      }
    }
    setRetryingIndex(null);
  }, [state.chapters, state.draftId, state.generationState, state.projectName, state.docType, dispatch]);

  const handleNextChapter = () => {
    if (state.currentChapterIndex >= state.chapters.length - 1) {
      dispatch({ type: "SET_STAGE", payload: "complete" });
    } else {
      dispatch({ type: "NEXT_CHAPTER" });
    }
  };

  const [reviseLoading, setReviseLoading] = useState(false);
  const [aiVisualLoading, setAiVisualLoading] = useState(false);

  const handleReviseContent = useCallback(async () => {
    const selText = getSelectedText();
    if (!selText || !state.demandInput.trim()) return;
    const chIdx = state.currentChapterIndex;
    markProcessing(chIdx, true);
    setReviseLoading(true);
    const chTitle = state.chapters[chIdx]?.title || "";
    try {
      // 注意：不要在此处 focus()——API 调用是异步的，调用期间用户可能改变选中，
      // 且 focus 后再 await 会导致 Slate 选中状态在 API 返回时已失效。
      // replaceSelection 内部会自行 focus 并确保选中有效。

      const resp = await reviseContent({
        original_content: selText,
        demand: state.demandInput,
        chapter_title: chTitle,
        word_count_min: state.wordCountMin || undefined,
        word_count_max: state.wordCountMax || undefined,
        model_name: state.modelName || undefined,
      });
      if (resp.success && resp.content) {
        const html = mdToHtml(resp.content);
        // 如果编辑器内有选中文字则替换，否则在光标处插入
        editorRef.current?.replaceSelection(html);
        dispatch({ type: "CLEAR_SELECTION" });
        dispatch({ type: "SET_DEMAND_INPUT", payload: "" });
        toast.success("内容已修改");
      } else {
        toast.error("修改失败，请重试");
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "修改请求失败";
      toast.error(msg);
    } finally {
      setReviseLoading(false);
      markProcessing(state.currentChapterIndex, false);
    }
  }, [state.selectedText, state.demandInput, state.wordCountMin, state.wordCountMax, state.chapters, state.currentChapterIndex, dispatch]);

  if (!currentChapter) {
    return (
      <div className="flex h-full w-full items-center justify-center text-muted-foreground text-sm">
        {isAnyGenerating ? t.writing.aiGeneratingContent : t.writing.noChapters}
      </div>
    );
  }

  return (
    <div className="flex h-full w-full">
      {/* ── 左侧面板 ────────────────────────────────────────────────── */}
      <div data-writing-left-panel className="flex w-80 shrink-0 flex-col border-r bg-muted/20 overflow-y-auto">
        {/* 章节标题 */}
        <div className="border-b p-3 shrink-0">
          <span className="text-xs font-medium text-muted-foreground">
            {t.writing.chapterOf.replace("{current}", String(state.currentChapterIndex + 1)).replace("{total}", String(state.chapters.length))}
          </span>
          <h3 className="mt-1 truncate text-sm font-semibold">{currentChapter.title}</h3>
        </div>

        {/* 章节列表 */}
        <div className="flex-1 border-b p-2 overflow-y-auto">
          <div className="space-y-1">
            {state.chapters.map((ch, i) => {
              const hasContent = (ch.content || "").includes("<p>");
              // 无内容的章节在生成过程中不可选中，有内容的可立即查看
              const isBusy = (!hasContent && isAnyGenerating) || processingChapters.has(i);
              const isGenerated = hasContent;
              return (
                <button
                  key={ch.id}
                  disabled={isBusy}
                  className={`w-full rounded-md px-3 py-1.5 text-left text-sm transition-colors ${
                    i === state.currentChapterIndex && !isBusy
                      ? "bg-primary text-primary-foreground"
                      : isBusy
                        ? "bg-muted/50 text-muted-foreground cursor-not-allowed"
                        : "hover:bg-muted text-muted-foreground"
                  }`}
                  onClick={() => {
                    if (!isBusy) dispatch({ type: "SET_CURRENT_CHAPTER", payload: i });
                  }}
                >
                  <span className="flex items-center gap-2">
                    <span className="text-xs opacity-60">{i + 1}.</span>
                    <span className="flex-1 truncate">{ch.title}</span>
                    {isBusy && <Loader2 className="size-3 shrink-0 animate-spin" />}
                    {isGenerated && !isBusy && <Sparkles className="size-3 shrink-0 text-green-500" />}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 修改需求 + 字数范围（合并） */}
        <div className="border-b p-3 shrink-0">
          <label className="text-xs font-medium text-muted-foreground">
            {t.writing.modify}
          </label>
          <Textarea
            placeholder={t.writing.modifyPlaceholder}
            value={state.demandInput}
            onChange={(e) => dispatch({ type: "SET_DEMAND_INPUT", payload: e.target.value })}
            className="mt-1 min-h-[50px] text-sm"
          />
          <div className="mt-2 flex items-center gap-2">
            <Input
              type="number"
              placeholder={t.writing.wordCountMin}
              className="h-8 w-[70px] text-xs"
              value={state.wordCountMin || ""}
              onChange={(e) =>
                dispatch({
                  type: "SET_WORD_COUNT",
                  payload: { min: Number(e.target.value) || 0, max: state.wordCountMax },
                })
              }
            />
            <span className="text-muted-foreground text-xs">~</span>
            <Input
              type="number"
              placeholder={t.writing.wordCountMax}
              className="h-8 w-[70px] text-xs"
              value={state.wordCountMax || ""}
              onChange={(e) =>
                dispatch({
                  type: "SET_WORD_COUNT",
                  payload: { min: state.wordCountMin, max: Number(e.target.value) || 0 },
                })
              }
            />
            <Button
              size="sm"
              className="h-8 flex-1 text-xs"
              disabled={!getSelectedText() || !state.demandInput.trim() || reviseLoading || isChapterBusy}
              onClick={handleReviseContent}
            >
              {reviseLoading ? <Loader2 className="mr-1 size-3 animate-spin" /> : <Pencil className="mr-1 size-3" />}
              {reviseLoading ? t.writing.modifying : t.writing.modifyBtn}
            </Button>
          </div>
        </div>

        {/* 生成按钮 */}
        <div className="p-3 shrink-0">
          <div className="mt-1 space-y-2">
            <div className="flex items-center gap-2">
              <Select value={chartType} onValueChange={setChartType}>
                <SelectTrigger className="h-8 flex-1 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHART_TYPES.map((ct) => (
                    <SelectItem key={ct.value} value={ct.value} className="text-xs">
                      {ct.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                className="h-8 shrink-0 text-xs"
                disabled={!getSelectedText() || chartLoading || isChapterBusy}
                onClick={handleGenerateChart}
              >
                {chartLoading ? <Loader2 className="mr-1 size-3 animate-spin" /> : <BarChart3 className="mr-1 size-3" />}
                {chartLoading ? t.writing.generating : t.writing.generateChart}
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Select value={diagramType} onValueChange={setDiagramType}>
                <SelectTrigger className="h-8 flex-1 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DIAGRAM_TYPES.map((dt) => (
                    <SelectItem key={dt.value} value={dt.value} className="text-xs">
                      {dt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                className="h-8 shrink-0 text-xs"
                disabled={!getSelectedText() || diagramLoading || isChapterBusy}
                onClick={handleGenerateDiagram}
              >
                {diagramLoading ? <Loader2 className="mr-1 size-3 animate-spin" /> : <GitFork className="mr-1 size-3" />}
                {diagramLoading ? t.writing.generating : t.writing.generateDiagram}
              </Button>
            </div>
            <Button
              className="w-full justify-start text-xs"
              size="sm"
              variant="outline"
              disabled={!getSelectedText() || tableLoading}
              onClick={handleGenerateTable}
            >
              {tableLoading ? <Loader2 className="mr-2 size-3 animate-spin" /> : <Table2 className="mr-2 size-3" />}
              {t.writing.generateTable}
            </Button>
            </div>
          </div>
        </div>

        {/* ── 右侧编辑区 ──────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden relative">
        {/* 右侧顶部导航 */}
        <div className="flex items-center justify-end border-b px-4 py-2 shrink-0">
          <div className="flex items-center gap-2">
            {/* 保存按钮（Ctrl+S） */}
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              disabled={state.saving}
              onClick={async () => {
                try {
                  await saveDraft();
                  toast.success(t.writing.saveSuccess);
                } catch {
                  toast.error(t.writing.saveFailed);
                }
              }}
            >
              {state.saving ? <Loader2 className="mr-1 size-3 animate-spin" /> : t.writing.save}
            </Button>
            <Button
              size="sm"
              className="text-xs"
              disabled={!allGenerated || processingChapters.size > 0}
              onClick={() => dispatch({ type: "SET_STAGE", payload: "complete" })}
            >
              {t.writing.nextStage} <ChevronRight className="ml-1 size-3" />
            </Button>
          </div>
        </div>

        {/* 编辑器区域：始终渲染 WangEditor，用覆盖层展示加载/空状态 */}
        <div className="flex-1 relative min-h-0">
          {/* 覆盖层：内容为空时的加载或重试 */}
          {!currentChapter?.content || isContentEffectivelyEmpty(currentChapter.content) ? (
            isAnyGenerating ? (
              <div className="absolute inset-0 flex items-center justify-center gap-4 z-10 bg-background text-muted-foreground">
                <Loader2 className="size-8 animate-spin" />
                <p className="text-sm">{t.writing.aiGeneratingContent}</p>
              </div>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center gap-6 z-10 bg-background text-muted-foreground">
                <AlertCircle className="size-12 text-amber-500" />
                <div className="text-center">
                  <p className="text-base font-medium">{t.writing.contentEmpty}</p>
                  <p className="mt-1 text-sm opacity-70">
                    {t.writing.contentEmptyHint}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={retryingIndex === state.currentChapterIndex}
                  onClick={() => handleRetryChapter(state.currentChapterIndex)}
                >
                    {retryingIndex === state.currentChapterIndex ? (
                    <><Loader2 className="mr-2 size-4 animate-spin" /> {t.writing.retrying}</>
                  ) : (
                    <><RefreshCw className="mr-2 size-4" /> {t.writing.retry}</>
                  )}
                </Button>
              </div>
            )
          ) : syncing ? (
            /* 覆盖层：内容同步中（编辑器在下方已渲染，加载完自动消失） */
            <div className="absolute inset-0 flex items-center justify-center gap-4 z-10 bg-background/80 text-muted-foreground">
              <Loader2 className="size-8 animate-spin" />
              <p className="text-sm">{t.writing.loading}</p>
            </div>
          ) : null}

          {/* 只在有内容或非生成中时渲染编辑器：空内容 + 生成中跳过渲染，避免 Slate 空节点崩溃 */}
          {(currentChapter?.content || !isAnyGenerating) && (
            <EditorErrorBoundary chapterKey={state.currentChapterIndex}>
              <WangEditor
                ref={editorRef}
                content={currentChapter?.content || ""}
                onChange={handleContentChange}
                placeholder={`开始撰写「${currentChapter?.title || ""}」...`}
                chapterKey={state.currentChapterIndex}
              />
            </EditorErrorBoundary>
          )}
        </div>
      </div>
    </div>
  );
}
