"use client";

import { FileText, Shapes, Sparkles } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";
import { useI18n } from "@/core/i18n/hooks";

import { FromScratchForm } from "./from-scratch-form";
import { FileSelector } from "./file-selector";

type PreflowMode = "choose" | "from-scratch" | "select-file";

interface PreflowPageProps {
  /** 用户完成前置操作后回调（进入编辑器） */
  onStart: (xml: string, title: string) => void;
}

/**
 * 绘图io 前置页面
 *
 * 类似全文写作的 StageOne，提供两种进入编辑器的路径：
 * 1. "从零开始" — 输入文字需求，AI 生成初始图表
 * 2. "选择文件" — 从 user-data 中选择已有文件
 *
 * 点击任意模式卡片后进入对应的表单界面。
 */
export function PreflowPage({ onStart }: PreflowPageProps) {
  const { t } = useI18n();
  const [mode, setMode] = useState<PreflowMode>("choose");

  // 模式选择卡片
  if (mode === "choose") {
    return (
      <div className="flex h-full w-full items-center justify-center p-8">
        <div className="flex w-full max-w-2xl flex-col gap-6">
          {/* 标题 */}
          <div className="text-center">
            <Shapes className="mx-auto mb-3 size-10 text-primary" />
            <h1 className="text-xl font-semibold">{t.drawio.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t.drawio.description}
            </p>
          </div>

          {/* 模式选择 */}
          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={() => setMode("from-scratch")}
              className={cn(
                "flex flex-col items-center gap-3 rounded-xl border p-6 text-center transition-all",
                "hover:border-primary/50 hover:bg-accent/50",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              <div className="flex size-12 items-center justify-center rounded-full bg-primary/10">
                <Sparkles className="size-6 text-primary" />
              </div>
              <div>
                <h3 className="font-medium">{t.drawio.fromScratchTitle}</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t.drawio.fromScratchDesc}
                </p>
              </div>
            </button>

            <button
              onClick={() => setMode("select-file")}
              className={cn(
                "flex flex-col items-center gap-3 rounded-xl border p-6 text-center transition-all",
                "hover:border-primary/50 hover:bg-accent/50",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              <div className="flex size-12 items-center justify-center rounded-full bg-primary/10">
                <FileText className="size-6 text-primary" />
              </div>
              <div>
                <h3 className="font-medium">{t.drawio.selectFileTitle}</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t.drawio.selectFileDesc}
                </p>
              </div>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // "从零开始"表单
  if (mode === "from-scratch") {
    return (
      <div className="flex h-full w-full items-center justify-center p-8">
        <div className="w-full max-w-lg">
          <button
            onClick={() => setMode("choose")}
            className="mb-4 text-xs text-muted-foreground hover:text-foreground"
          >
            &larr; {t.drawio.title}
          </button>
          <FromScratchForm onComplete={onStart} />
        </div>
      </div>
    );
  }

  // "选择文件"
  return (
    <div className="flex h-full w-full items-center justify-center p-8">
      <div className="flex h-full w-full max-w-lg flex-col">
        <button
          onClick={() => setMode("choose")}
          className="mb-4 shrink-0 text-left text-xs text-muted-foreground hover:text-foreground"
        >
          &larr; {t.drawio.title}
        </button>
        <FileSelector onSelect={onStart} />
      </div>
    </div>
  );
}
