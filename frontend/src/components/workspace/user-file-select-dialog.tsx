"use client";

import { FileTextIcon, ListIcon, LoaderIcon, SearchIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getBackendBaseURL } from "@/core/config";
import { useUserFiles } from "@/core/user-files";
import {
  getFileExtensionDisplayName,
  getFileIcon,
  groupFilesByCategory,
  getCategoryIcon,
  getCategoryLabel,
  FILE_CATEGORIES,
} from "@/core/utils/files";
import type { FileCategory } from "@/core/utils/files";
import { cn } from "@/lib/utils";

export function UserFileSelectDialog({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (file: { filename: string; url: string; size?: number }) => void;
}) {
  const { data, isLoading } = useUserFiles();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<"all" | FileCategory>("all");

  const filteredFiles = useMemo(() => {
    if (!data?.files) return [];
    if (!searchQuery.trim()) return data.files;
    const q = searchQuery.toLowerCase();
    return data.files.filter((f) =>
      f.filename.toLowerCase().includes(q),
    );
  }, [data?.files, searchQuery]);

  const grouped = useMemo(
    () => groupFilesByCategory(filteredFiles),
    [filteredFiles],
  );

  const visibleGroups = useMemo(
    () =>
      activeCategory === "all"
        ? grouped
        : grouped.filter((g) => g.category === activeCategory),
    [grouped, activeCategory],
  );

  const handleSelect = useCallback(
    async (filename: string, size?: number) => {
      const url = `${getBackendBaseURL()}/api/user/files/${encodeURIComponent(filename)}`;
      onSelect({ filename, url, size });
      onOpenChange(false);
    },
    [onSelect, onOpenChange],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[70vh] max-h-[calc(100vh-2rem)] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>选择文件</DialogTitle>
        </DialogHeader>

        {/* Search */}
        <div className="relative">
          <SearchIcon className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            className="pl-9"
            placeholder="搜索文件..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {/* Category filter */}
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setActiveCategory("all")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors",
              activeCategory === "all"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80",
            )}
          >
            <ListIcon className="size-3.5" />
            全部
            <span className="opacity-70">({filteredFiles.length})</span>
          </button>
          {FILE_CATEGORIES.map((cat) => (
            <button
              key={cat.key}
              type="button"
              onClick={() => setActiveCategory(cat.key)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors",
                activeCategory === cat.key
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80",
              )}
            >
              {getCategoryIcon(cat.key, "size-3.5")}
              {cat.label}
              <span className="opacity-70">
                ({grouped.find((g) => g.category === cat.key)?.files.length ?? 0})
              </span>
            </button>
          ))}
        </div>

        {/* File list */}
        <ScrollArea className="min-h-0 flex-1">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <LoaderIcon className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredFiles.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {data?.files?.length === 0
                ? "暂无文件，请先上传"
                : "没有匹配的文件"}
            </div>
          ) : (
            <div className="space-y-4">
              {visibleGroups.map(({ category, files }) => (
                <div key={category}>
                  <h4 className="mb-1.5 flex items-center gap-1.5 px-1 text-xs font-medium text-muted-foreground">
                    {getCategoryIcon(category, "size-3.5")}
                    <span>{getCategoryLabel(category)}</span>
                    <span>({files.length})</span>
                  </h4>
                  <div className="space-y-0.5">
                    {files.map((file) => (
                      <button
                        key={file.filename}
                        type="button"
                        className={cn(
                          "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
                          "hover:bg-muted hover:text-foreground",
                          "text-muted-foreground cursor-pointer",
                        )}
                        onClick={() =>
                          handleSelect(
                            file.filename,
                            typeof file.size === "number"
                              ? file.size
                              : Number(file.size) || 0,
                          )
                        }
                      >
                        <div className="shrink-0">
                          {getFileIcon(file.filename, "size-5") ?? (
                            <FileTextIcon className="size-5" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium text-foreground">
                            {file.filename}
                          </div>
                          <div className="text-xs">
                            {getFileExtensionDisplayName(file.filename)}
                            {file.size
                              ? ` · ${typeof file.size === "number" ? (file.size / 1024).toFixed(1) : (Number(file.size) / 1024).toFixed(1)} KB`
                              : ""}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
