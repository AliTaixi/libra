"use client";

import { CheckIcon, Loader2Icon, SendHorizonal, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorName,
  ModelSelectorTrigger,
} from "@/components/ai-elements/model-selector";
import { fetch as authFetch } from "@/core/api/fetcher";
import { useModels } from "@/core/models/hooks";

interface DrawioPanelProps {
  xmlCode: string;
  onGenerate: (xml: string) => void;
  isApplying?: boolean;
}

/**
 * 右侧面板：
 * - 上半：可编辑 XML（行号 + 实时同步到编辑器）
 * - 下半：AI 输入栏（模型选择器内嵌，类似新对话）
 */
export function DrawioPanel({
  xmlCode,
  onGenerate,
  isApplying = false,
}: DrawioPanelProps) {
  const { models } = useModels();
  const [modelName, setModelName] = useState<string | undefined>();
  const [input, setInput] = useState("");
  const [generating, setGenerating] = useState(false);
  const [localXml, setLocalXml] = useState(xmlCode);
  const [modelDialogOpen, setModelDialogOpen] = useState(false);
  const codeRef = useRef<HTMLTextAreaElement>(null);
  const lineNumRef = useRef<HTMLDivElement>(null);
  const isInternalEdit = useRef(false);

  // 同步外部 xmlCode 到本地（仅当不是本地编辑导致的变化时）
  useEffect(() => {
    if (!isInternalEdit.current) {
      setLocalXml(xmlCode);
    }
    isInternalEdit.current = false;
  }, [xmlCode]);

  // 默认选第一个模型
  useEffect(() => {
    if (!modelName && models.length > 0) setModelName(models[0].name);
  }, [models, modelName]);

  const selectedModel = useMemo(
    () => models.find((m) => m.name === modelName),
    [modelName, models],
  );

  // 行号
  const lineCount = useMemo(
    () => localXml.split("\n").length,
    [localXml],
  );

  /** 本地 XML 修改 → 实时同步到编辑器 */
  const handleXmlEdit = useCallback(
    (value: string) => {
      isInternalEdit.current = true;
      setLocalXml(value);
      try {
        if (value.includes("<mxGraphModel") && !value.includes("</mxGraphModel>")) {
          return;
        }
        if (value.trim() && value.includes("</")) {
          onGenerate(value);
        }
      } catch {
        toast.error("XML 格式错误", { duration: 2000 });
      }
    },
    [onGenerate],
  );

  /** 发送 AI 请求 */
  const handleSend = useCallback(async () => {
    const content = input.trim();
    if (!content || generating) return;
    setInput("");
    setGenerating(true);
    try {
      const resp = await authFetch("/api/drawio/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: content,
          current_xml: localXml || undefined,
          model_name: modelName,
        }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const xml = extractXml(data.xml ?? data.raw_content ?? "");
      if (xml) {
        isInternalEdit.current = true;
        setLocalXml(xml);
        onGenerate(xml);
      }
    } catch (e) {
      toast.error(`生成失败：${e instanceof Error ? e.message : "未知错误"}`);
    } finally {
      setGenerating(false);
    }
  }, [input, generating, localXml, modelName, onGenerate]);

  return (
    <div className="flex flex-1 flex-col bg-background min-h-0">
      {/* ── 上半：可编辑 XML（行号 + 代码，共用一个滚动容器） ── */}
      <div className="flex flex-1 min-h-0 border-b overflow-y-auto">
        {/* 行号区 */}
        <div
          ref={lineNumRef}
          className="select-none shrink-0 bg-muted/20 px-2 pt-3 pb-3 text-right text-[11px] leading-[1.6] text-muted-foreground/40"
          style={{ width: 40 }}
        >
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>

        {/* 代码编辑区 */}
        <div className="flex-1 min-w-0">
          <textarea
            ref={codeRef}
            value={localXml}
            onChange={(e) => handleXmlEdit(e.target.value)}
            className="w-full resize-none border-0 bg-transparent p-3 font-mono text-[11px] leading-[1.6] text-muted-foreground outline-none focus:ring-0 overflow-hidden block"
            spellCheck={false}
            rows={lineCount}
          />
        </div>
      </div>

      {/* ── 下半：AI 输入栏（新对话风格） ── */}
      <div className="shrink-0 border-t bg-background p-3">
        <div className="relative flex items-end gap-2 rounded-xl border bg-muted/20 p-2 focus-within:border-primary/50">
          {/* 模型选择器（在输入框左侧） */}
          {models.length > 0 && (
            <ModelSelector
              open={modelDialogOpen}
              onOpenChange={setModelDialogOpen}
            >
              <ModelSelectorTrigger asChild>
                <button
                  type="button"
                  className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted transition-colors"
                >
                  <Sparkles className="size-3" />
                  <span className="max-w-[60px] truncate">
                    {selectedModel?.display_name ?? "模型"}
                  </span>
                </button>
              </ModelSelectorTrigger>
              <ModelSelectorContent>
                <ModelSelectorInput placeholder="搜索模型..." />
                <ModelSelectorList>
                  {models.map((m) => (
                    <ModelSelectorItem
                      key={m.name}
                      value={m.name}
                      onSelect={() => {
                        setModelName(m.name);
                        setModelDialogOpen(false);
                      }}
                    >
                      <div className="flex min-w-0 flex-1 flex-col">
                        <ModelSelectorName>{m.display_name}</ModelSelectorName>
                        <span className="text-muted-foreground truncate text-[10px]">
                          {m.model}
                        </span>
                      </div>
                      {m.name === modelName ? (
                        <CheckIcon className="ml-auto size-4" />
                      ) : (
                        <div className="ml-auto size-4" />
                      )}
                    </ModelSelectorItem>
                  ))}
                </ModelSelectorList>
              </ModelSelectorContent>
            </ModelSelector>
          )}

          {/* 输入框 */}
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="描述你想绘制的图表..."
            className="min-h-8 flex-1 resize-none border-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground/40"
            rows={1}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />

          {/* 发送按钮 */}
          <button
            type="button"
            className="flex shrink-0 items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted disabled:opacity-30"
            disabled={!input.trim() || generating || models.length === 0}
            onClick={handleSend}
          >
            {generating || isApplying ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <SendHorizonal className="size-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function extractXml(text: string): string {
  const m = text.match(/```(?:xml)?\s*([\s\S]*?)```/);
  if (m) {
    const e = m[1].trim();
    if (e.startsWith("<mxGraphModel") || e.startsWith("<?xml")) return e;
  }
  const mx = text.match(/<mxGraphModel[\s\S]*?<\/mxGraphModel>/);
  return mx ? mx[0] : text;
}
