"use client";

import { useState, useEffect } from "react";
import { Download, ChevronLeft, FileText, Loader2 } from "lucide-react";
import { useI18n } from "@/core/i18n/hooks";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { useWritingState, useWritingDispatch } from "../store/writing-store";
import { getBackendBaseURL } from "@/core/config";
import { fetch as authFetch } from "@/core/api/fetcher";

function countChars(html: string): number {
  return html.replace(/<[^>]*>/g, "").replace(/\s/g, "").length;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** HTML → Markdown（零依赖，保留粗体/斜体/链接/表格/列表等基本格式） */
function htmlToMarkdown(html: string): string {
  return html
    // 块级结束标签 → 双换行
    .replace(/<\/(?:h[1-6]|p|li|div|blockquote|pre|tr|td)>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<hr\s*\/?>/gi, "\n\n---\n\n")
    // 行内样式
    .replace(/<(?:strong|b)\s*>/gi, "**").replace(/<\/(?:strong|b)>/gi, "**")
    .replace(/<(?:em|i)\s*>/gi, "*").replace(/<\/(?:em|i)>/gi, "*")
    .replace(/<u\s*>/gi, "++").replace(/<\/u>/gi, "++")
    .replace(/<(?:s|del)\s*>/gi, "~~").replace(/<\/(?:s|del)>/gi, "~~")
    .replace(/<code\s*>/gi, "`").replace(/<\/code>/gi, "`")
    // 链接 / 图片
    .replace(/<a\s+(?:[^>]*?\s)?href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)")
    .replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, "![$2]($1)")
    .replace(/<img[^>]*src="([^"]*)"[^>]*\/?>/gi, "![]($1)")
    // 列表
    .replace(/<ul[^>]*>/gi, "").replace(/<\/ul>/gi, "")
    .replace(/<ol[^>]*>/gi, "").replace(/<\/ol>/gi, "")
    .replace(/<li[^>]*>/gi, "\n- ").replace(/<\/li>/gi, "")
    // 代码块
    .replace(/<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, "\n\n```\n$1\n```\n\n")
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, "\n\n```\n$1\n```\n\n")
    // 引用
    .replace(/<blockquote[^>]*>/gi, "\n\n> ").replace(/<\/blockquote>/gi, "")
    // 标题
    .replace(/<h1[^>]*>/gi, "\n\n# ").replace(/<\/h1>/gi, "\n")
    .replace(/<h2[^>]*>/gi, "\n\n## ").replace(/<\/h2>/gi, "\n")
    .replace(/<h3[^>]*>/gi, "\n\n### ").replace(/<\/h3>/gi, "\n")
    .replace(/<h4[^>]*>/gi, "\n\n#### ").replace(/<\/h4>/gi, "\n")
    // 表格
    .replace(/<table[^>]*>/gi, "\n\n").replace(/<\/table>/gi, "\n")
    .replace(/<tr[^>]*>/gi, "\n").replace(/<\/tr>/gi, "")
    .replace(/<th[^>]*>/gi, "| ").replace(/<\/th>/gi, " ")
    .replace(/<td[^>]*>/gi, "| ").replace(/<\/td>/gi, " ")
    // 清理
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

// ── 预览区字体样式 ──────────────────────────────────────────────
function usePreviewFontStyle() {
  useEffect(() => {
    if (document.getElementById("writing-preview-font-style")) return;
    const s = document.createElement("style");
    s.id = "writing-preview-font-style";
    s.textContent = [
      `.writing-preview{font-family:'Times New Roman',SimSun,serif!important;line-height:1.6!important}`,
      `.writing-preview p{text-indent:2em!important;margin:0 0 0.25em!important}`,
      `.writing-preview strong,.writing-preview b{font-weight:700!important}`,
      `.writing-preview a{font-family:Calibri,'Times New Roman',SimSun,serif!important}`,
      `.writing-preview h1,.writing-preview h2,.writing-preview h3,.writing-preview h4{font-weight:700!important;text-indent:0!important;margin:0.5em 0 0.25em!important}`,
      `.writing-preview li{text-indent:0!important}`,
    ].join("");
    document.head.appendChild(s);
  }, []);
}

export function StageThree() {
  usePreviewFontStyle();
  const { t } = useI18n();
  const state = useWritingState();
  const dispatch = useWritingDispatch();
  const [exporting, setExporting] = useState(false);

  const totalWords = state.chapters.reduce((sum, ch) => sum + countChars(ch.content), 0);

  const handleExportDocx = async () => {
    setExporting(true);
    try {
      // 拼接所有章节的完整 HTML（后端自动处理图片下载）
      const fullHtml = state.chapters
        .map(ch => ch.content || "")
        .join("\n\n");

      const resp = await authFetch(`${getBackendBaseURL()}/api/writing/export-html-docx`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          html: fullHtml,
          output_name: `${state.projectName || t.writing.untitled}.docx`,
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: `HTTP ${resp.status}` }));
        throw new Error(err.detail ?? t.writing.exportFailed);
      }

      const blob = await resp.blob();
      const filename = `${state.projectName || t.writing.untitled}.docx`;
      downloadBlob(blob, filename);
      toast.success(t.writing.exportSuccess.replace("{filename}", filename));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t.writing.exportFailed;
      toast.error(msg);
    } finally {
      setExporting(false);
    }
  };

  const handleGoBack = () => {
    dispatch({ type: "SET_STAGE", payload: "writing" });
  };

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={handleGoBack}>
            <ChevronLeft className="mr-1 size-4" /> {t.writing.backToEdit}
          </Button>
          <h2 className="text-lg font-semibold">{t.writing.completeStage}</h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-sm">
            {t.writing.totalWords.replace("{count}", String(totalWords)).replace("{chapters}", String(state.chapters.length))}
          </span>
        </div>
      </div>

      <div className="flex flex-1 gap-4 overflow-hidden p-6">
        <div className="flex w-56 shrink-0 flex-col gap-2">
          <h3 className="text-xs font-medium text-muted-foreground">{t.writing.chapterList}</h3>
          <ScrollArea className="flex-1">
            <div className="space-y-1">
              {state.chapters.map((ch, i) => {
                const words = countChars(ch.content);
                return (
                  <div key={ch.id} className="flex items-center justify-between rounded-md px-3 py-1.5 text-sm hover:bg-muted/50">
                    <span className="truncate">
                      <span className="text-muted-foreground">{i + 1}.</span> {ch.title}
                    </span>
                    <span className="text-muted-foreground ml-2 shrink-0 text-xs">{t.writing.words.replace("{count}", String(words))}</span>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </div>

        <div className="flex flex-1 flex-col gap-4">
          <Card className="flex-1">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{t.writing.documentPreview}</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[calc(100vh-20rem)]">
                <div className="writing-preview">
                  {state.chapters.map((ch, i) => (
                    <div key={ch.id} className={i > 0 ? "mt-6" : ""}>
                      <div dangerouslySetInnerHTML={{ __html: ch.content || `<p class='text-muted-foreground'>${t.writing.notWritten}</p>` }} />
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {state.files.filter((f) => f.type === "template").map((f) => (
                <div key={f.path} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <FileText className="size-3" /> {f.name}
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleGoBack}>{t.writing.continueEditing}</Button>
              <Button onClick={handleExportDocx} disabled={exporting}>
                {exporting ? <><Loader2 className="mr-1 size-4 animate-spin" /> {t.writing.exporting}</> : <><Download className="mr-1 size-4" /> {t.writing.exportWord}</>}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
