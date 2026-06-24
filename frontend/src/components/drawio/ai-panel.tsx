"use client";

import {
  AlertCircle,
  Bot,
  CheckCheck,
  Loader2,
  SendHorizonal,
  User,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorName,
  ModelSelectorTrigger,
} from "@/components/ai-elements/model-selector";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/core/i18n/hooks";
import { useModels } from "@/core/models/hooks";

import type { ChatMessage } from "@/core/drawio/types";
import { fetch as authFetch } from "@/core/api/fetcher";

interface AiPanelProps {
  /** 当前图表的 XML（用于上下文修改） */
  currentXml?: string;
  /** AI 生成回调：返回生成的 XML */
  onGenerate: (xml: string) => void;
  /** 是否正在应用 AI 生成的图表 */
  isApplying?: boolean;
}

/**
 * AI 智能助手面板
 *
 * 分屏布局右侧的 AI 对话界面，支持：
 * - 自然语言描述生成图表
 * - 对已有图表进行修改
 * - 选择不同的 LLM 模型
 * - 应用/放弃 AI 生成的结果
 */
export function AiPanel({
  currentXml,
  onGenerate,
  isApplying = false,
}: AiPanelProps) {
  const { t } = useI18n();
  const { models } = useModels();
  const [modelName, setModelName] = useState<string | undefined>();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [generating, setGenerating] = useState(false);
  const [pendingXml, setPendingXml] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 默认选中第一个模型
  useEffect(() => {
    if (!modelName && models.length > 0) {
      setModelName(models[0].name);
    }
  }, [models, modelName]);

  const selectedModel = useMemo(() => {
    return models.find((m) => m.name === modelName);
  }, [modelName, models]);

  // 自动滚动到底部
  useEffect(() => {
    if (scrollRef.current) {
      const el = scrollRef.current;
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  /** 发送消息给 AI */
  const handleSend = useCallback(async () => {
    const content = input.trim();
    if (!content || generating) return;

    // 添加用户消息
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setGenerating(true);
    setPendingXml(null);

    // 构建系统提示词（指导 LLM 生成 draw.io XML）
    const systemPrompt = buildSystemPrompt(currentXml);

    try {
      // 调用 AI 生成
      const response = await fetchDrawioAI(content, currentXml, modelName);

      if (!response.success) {
        throw new Error(response.error ?? "生成失败");
      }

      // 添加 AI 回复消息
      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: response.rawContent,
        drawioXml: response.xml,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
      setPendingXml(response.xml);
    } catch (err) {
      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: `生成失败：${err instanceof Error ? err.message : "未知错误"}`,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setGenerating(false);
    }
  }, [input, generating, currentXml, modelName]);

  /** 应用 AI 生成的图表 */
  const handleApply = useCallback(() => {
    if (pendingXml) {
      onGenerate(pendingXml);
      setPendingXml(null);
    }
  }, [pendingXml, onGenerate]);

  /** 放弃 AI 生成的图表 */
  const handleReject = useCallback(() => {
    setPendingXml(null);
  }, []);

  /** 清空对话 */
  const handleClear = useCallback(() => {
    setMessages([]);
    setPendingXml(null);
  }, []);

  return (
    <div className="flex h-full flex-col bg-background">
      {/* 头部 */}
      <div className="flex shrink-0 items-center justify-between border-b px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Bot className="size-4 text-primary" />
          <span className="text-sm font-medium">{t.drawio.aiAssistant}</span>
        </div>
        <div className="flex items-center gap-1">
          {/* 模型选择器 */}
          {models.length > 0 && (
            <ModelSelector>
              <ModelSelectorTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 text-xs">
                  <ModelSelectorName>
                    {selectedModel?.display_name ?? t.drawio.aiSelectModel}
                  </ModelSelectorName>
                </Button>
              </ModelSelectorTrigger>
              <ModelSelectorContent>
                <ModelSelectorList>
                  {models.map((m) => (
                    <ModelSelectorItem
                      key={m.name}
                      value={m.name}
                      onSelect={() => setModelName(m.name)}
                    >
                      <ModelSelectorName>{m.display_name}</ModelSelectorName>
                      {m.name === modelName && (
                        <CheckCheck className="ml-auto size-4" />
                      )}
                    </ModelSelectorItem>
                  ))}
                </ModelSelectorList>
              </ModelSelectorContent>
            </ModelSelector>
          )}
          {messages.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground"
              onClick={handleClear}
            >
              {t.drawio.clearChat}
            </Button>
          )}
        </div>
      </div>

      {/* 消息列表 */}
      <ScrollArea className="flex-1">
        <div ref={scrollRef} className="flex flex-col gap-3 p-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center pt-12 text-center">
              <Bot className="mb-3 size-10 text-muted-foreground/40" />
              <p className="text-sm font-medium text-muted-foreground/70">
                {t.drawio.title}
              </p>
              <p className="mt-1 max-w-[240px] text-xs text-muted-foreground/50">
                {t.drawio.aiPlaceholder}
              </p>
              <div className="mt-4 flex flex-col gap-1.5">
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    className="rounded-md border px-3 py-1.5 text-left text-xs text-muted-foreground/70 transition-colors hover:bg-accent"
                    onClick={() => {
                      setInput(s);
                      inputRef.current?.focus();
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex gap-2 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}
            >
              {/* 头像 */}
              <div
                className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ${msg.role === "user" ? "bg-primary/10" : "bg-muted"}`}
              >
                {msg.role === "user" ? (
                  <User className="size-3.5 text-primary" />
                ) : (
                  <Bot className="size-3.5 text-muted-foreground" />
                )}
              </div>

              {/* 消息气泡 */}
              <div
                className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted"
                }`}
              >
                <p className="whitespace-pre-wrap break-words">{msg.content}</p>

                {/* AI 回复中有 XML 时显示操作按钮 */}
                {msg.drawioXml && msg.role === "assistant" && (
                  <div className="mt-3 flex items-center gap-2 border-t pt-2">
                    <Button
                      size="sm"
                      variant="default"
                      className="h-7 text-xs"
                      disabled={isApplying}
                      onClick={handleApply}
                    >
                      {isApplying ? (
                        <>
                          <Loader2 className="mr-1 size-3 animate-spin" />
                          {t.drawio.aiApplying}
                        </>
                      ) : (
                        t.drawio.aiApply
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      disabled={isApplying}
                      onClick={handleReject}
                    >
                      <X className="mr-1 size-3" />
                      {t.drawio.aiReject}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* 生成中状态 */}
          {generating && (
            <div className="flex gap-2">
              <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
                <Bot className="size-3.5 text-muted-foreground" />
              </div>
              <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                <span>{t.drawio.aiGenerating}</span>
              </div>
            </div>
          )}

          {/* 无模型提示 */}
          {models.length === 0 && (
            <div className="mt-4 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
              <AlertCircle className="size-3.5 shrink-0" />
              <span>{t.drawio.aiNoModel}</span>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* 输入区域 */}
      <div className="shrink-0 border-t p-3">
        <div className="flex gap-2">
          <Textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t.drawio.aiPlaceholder}
            className="min-h-9 resize-none text-sm"
            rows={2}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          <Button
            size="icon"
            className="mt-auto size-9 shrink-0"
            disabled={!input.trim() || generating || models.length === 0}
            onClick={handleSend}
          >
            {generating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <SendHorizonal className="size-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** 快捷建议提示 */
const suggestions = [
  "画一个用户登录的流程图",
  "画一个微服务架构图",
  "画一个数据库 ER 图",
  "帮我画一个时序图",
];

/**
 * 构建给 LLM 的系统提示词
 */
function buildSystemPrompt(currentXml?: string): string {
  const parts = [
    "你是一个专业图表生成助手。请根据用户描述生成 draw.io 原生 XML 格式的图表。",
    "",
    "要求：",
    "- 输出必须是有效的 draw.io XML（mxGraphModel 格式）",
    "- 使用干净的专业配色",
    "- 文字使用中文",
    "- 合理布局，避免元素重叠",
    "- 只输出 XML，不要额外的解释",
    "",
    "XML 格式示例：",
    `<mxGraphModel>
  <root>
    <mxCell id="0" />
    <mxCell id="1" parent="0" />
    <mxCell id="2" value="开始" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1">
      <mxGeometry x="40" y="40" width="120" height="40" as="geometry" />
    </mxCell>
  </root>
</mxGraphModel>`,
  ];

  if (currentXml) {
    parts.push(
      "",
      "当前已有图表的 XML 如下。请根据用户指令对其进行修改，保留原有结构，只修改用户要求的部分：",
      "",
      currentXml,
    );
  }

  return parts.join("\n");
}

/**
 * 调用后端 API 生成 draw.io 图表
 */
async function fetchDrawioAI(
  prompt: string,
  currentXml?: string,
  modelName?: string,
) {
  try {
    const response = await authFetch("/api/drawio/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        current_xml: currentXml,
        model_name: modelName,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      return {
        xml: "",
        rawContent: "",
        success: false,
        error: `HTTP ${response.status}: ${errText.slice(0, 200)}`,
      };
    }

    const data = await response.json();
    // 尝试从返回中提取 XML
    const xml = extractDrawioXml(data.xml ?? data.raw_content ?? "");
    return {
      xml,
      rawContent: data.raw_content ?? data.xml ?? "",
      success: true,
    };
  } catch (err) {
    return {
      xml: "",
      rawContent: "",
      success: false,
      error: err instanceof Error ? err.message : "网络请求失败",
    };
  }
}

/**
 * 从 LLM 返回的文本中提取 draw.io XML
 * LLM 可能会在 markdown 代码块中返回 XML
 */
function extractDrawioXml(text: string): string {
  // 尝试提取 ```xml ... ``` 中的内容
  const xmlBlockMatch = text.match(/```(?:xml)?\s*([\s\S]*?)```/);
  if (xmlBlockMatch) {
    const extracted = xmlBlockMatch[1].trim();
    if (extracted.startsWith("<mxGraphModel") || extracted.startsWith("<?xml")) {
      return extracted;
    }
  }

  // 尝试直接匹配 mxGraphModel
  const mxMatch = text.match(/<mxGraphModel[\s\S]*?<\/mxGraphModel>/);
  if (mxMatch) {
    return mxMatch[0];
  }

  // 返回原始文本
  return text;
}
