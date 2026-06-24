"use client";

import { FileText, FolderOpen, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fetch as authFetch } from "@/core/api/fetcher";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

/** 允许的文件扩展名 */
const ALLOWED_EXTENSIONS = new Set([".drawio", ".xml"]);

interface UserFile {
  filename: string;
  size: string;
  extension: string;
  download_url: string;
}

interface FileSelectorProps {
  /** 选择文件后回调 */
  onSelect: (xml: string, fileName: string) => void;
}

/**
 * "选择文件"组件
 *
 * 从 /api/user/files 加载用户文件列表，
 * 过滤出 draw.io 兼容的文件（.drawio、.xml），
 * 点击后读取内容并通过 onSelect 回调传入编辑器。
 */
export function FileSelector({ onSelect }: FileSelectorProps) {
  const { t } = useI18n();
  const [files, setFiles] = useState<UserFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [reading, setReading] = useState(false);

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch("/api/user/files");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const allFiles: UserFile[] = data.files ?? [];
      // 过滤出 draw.io 兼容的文件
      const drawioFiles = allFiles.filter((f) =>
        ALLOWED_EXTENSIONS.has(f.extension?.toLowerCase()),
      );
      setFiles(drawioFiles);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  const handleOpenFile = async (file: UserFile) => {
    setSelectedFile(file.filename);
    setReading(true);
    try {
      const res = await authFetch(file.download_url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();
      // 从文件名中去除扩展名作为标题
      const title = file.filename.replace(/\.(drawio|xml)$/i, "");
      onSelect(xml, title);
    } catch (err) {
      setError(`读取文件失败: ${err instanceof Error ? err.message : "未知错误"}`);
      setSelectedFile(null);
    } finally {
      setReading(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-4">
      {/* 头部说明 */}
      <div className="flex items-center gap-2">
        <FolderOpen className="size-5 text-primary" />
        <div>
          <h3 className="text-sm font-medium">{t.drawio.selectFileTitle}</h3>
          <p className="text-xs text-muted-foreground">
            {t.drawio.selectFileDesc}
          </p>
        </div>
      </div>

      {/* 文件列表 */}
      <ScrollArea className="flex-1">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" />
            <span className="text-sm">{t.drawio.preflowLoading}</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-3 py-12">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" onClick={fetchFiles}>
              <RefreshCw className="mr-1 size-3.5" />
              {t.drawio.preflowRetry}
            </Button>
          </div>
        ) : files.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <FileText className="mb-2 size-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground/70">
              {t.drawio.selectFileEmpty}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {files.map((file) => {
              const isSelected = selectedFile === file.filename;
              const isLoading = isSelected && reading;
              return (
                <button
                  key={file.filename}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-left transition-colors",
                    isSelected
                      ? "border-primary bg-primary/5"
                      : "border-transparent hover:bg-accent",
                  )}
                  onClick={() => handleOpenFile(file)}
                  disabled={reading}
                >
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {file.filename}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {file.extension?.toUpperCase()}
                  </span>
                  {isLoading && (
                    <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
