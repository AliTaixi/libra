"use client";

import { Bot, Loader2, SendHorizonal, Sparkles } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/core/i18n/hooks";

interface FromScratchFormProps {
  /** AI 生成完成回调 */
  onComplete: (xml: string, title: string) => void;
}

/**
 * "从零开始"表单
 *
 * 用户输入文字需求，调用后端 API 生成 draw.io 图表 XML，
 * 生成后通过 onComplete 回调传入编辑器。
 */
export function FromScratchForm({ onComplete }: FromScratchFormProps) {
  const { t } = useI18n();
  const [input, setInput] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    const content = input.trim();
    if (!content || generating) return;

    setGenerating(true);
    setError(null);

    try {
      const response = await fetch("/api/drawio/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: content }),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        throw new Error(`HTTP ${response.status}: ${errText.slice(0, 200)}`);
      }

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error ?? "生成失败");
      }

      onComplete(data.xml, input.slice(0, 30));
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成失败，请重试");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-4">
      {/* 头部说明 */}
      <div className="flex items-center gap-2">
        <Sparkles className="size-5 text-primary" />
        <div>
          <h3 className="text-sm font-medium">{t.drawio.fromScratchTitle}</h3>
          <p className="text-xs text-muted-foreground">
            {t.drawio.fromScratchDesc}
          </p>
        </div>
      </div>

      {/* 输入区域 */}
      <Textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={t.drawio.fromScratchPlaceholder}
        className="min-h-[120px] flex-1 resize-none text-sm"
        disabled={generating}
      />

      {/* 错误提示 */}
      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}

      {/* 生成按钮 */}
      <Button
        className="w-full"
        disabled={!input.trim() || generating}
        onClick={handleGenerate}
      >
        {generating ? (
          <>
            <Loader2 className="mr-2 size-4 animate-spin" />
            {t.drawio.aiGenerating}
          </>
        ) : (
          <>
            <SendHorizonal className="mr-2 size-4" />
            {t.drawio.fromScratchGenerate}
          </>
        )}
      </Button>
    </div>
  );
}
