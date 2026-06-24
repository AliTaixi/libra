"use client";

import {
  DownloadIcon,
  LoaderIcon,
  TrashIcon,
  FileTextIcon,
  ListIcon,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useI18n } from "@/core/i18n/hooks";
import { getBackendBaseURL } from "@/core/config";
import { useUserFiles, useDeleteUserFile } from "@/core/user-files";
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

import { SettingsSection } from "./settings-section";

export function FileManagementSettingsPage() {
  const { t } = useI18n();
  const { data, isLoading, error } = useUserFiles();
  const deleteMutation = useDeleteUserFile();
  const [activeCategory, setActiveCategory] = useState<"all" | FileCategory>("all");

  const grouped = useMemo(
    () => (data?.files ? groupFilesByCategory(data.files) : []),
    [data?.files],
  );

  const visibleGroups = useMemo(
    () =>
      activeCategory === "all"
        ? grouped
        : grouped.filter((g) => g.category === activeCategory),
    [grouped, activeCategory],
  );

  const handleDelete = useCallback(
    (filename: string) => {
      if (!window.confirm(t.settings.files.deleteConfirm.replace("{name}", filename))) {
        return;
      }
      deleteMutation.mutate(filename, {
        onSuccess: () => toast.success(`${t.settings.files.deleteSuccess}: ${filename}`),
        onError: (err) => toast.error(`${t.settings.files.deleteFailed}: ${err.message}`),
      });
    },
    [deleteMutation, t],
  );

  function downloadUrl(filename: string) {
    return `${getBackendBaseURL()}/api/user/files/${encodeURIComponent(filename)}?download=true`;
  }

  return (
    <SettingsSection
      title={t.settings.files.title}
      description={t.settings.files.description}
    >
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <LoaderIcon className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="py-12 text-center text-sm text-destructive">
          {t.settings.files.loadFailed}：{error.message}
        </div>
      ) : !data?.files?.length ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          {t.settings.files.empty}
        </div>
      ) : (
        <div className="space-y-4">
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
              {t.settings.files.all}
              <span className="opacity-70">({data?.files?.length ?? 0})</span>
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
          <div className="space-y-6">
            {visibleGroups.map(({ category, files }) => (
              <section key={category}>
                <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  {getCategoryIcon(category, "size-4")}
                  <span>{getCategoryLabel(category)}</span>
                  <span className="text-xs">({files.length})</span>
                </h3>
                <div className="space-y-2">
                  {files.map((file) => (
                    <Card key={file.filename} className="p-3">
                      <CardHeader className="grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 pr-2 pl-1">
                        <CardTitle className="relative min-w-0 pl-8 leading-tight [overflow-wrap:anywhere] break-words">
                          <div className="min-w-0">{file.filename}</div>
                          <div className="absolute top-2 -left-0.5">
                            {getFileIcon(file.filename, "size-6") ?? (
                              <FileTextIcon className="size-6" />
                            )}
                          </div>
                        </CardTitle>
                        <CardDescription className="min-w-0 pl-8 text-xs">
                          {getFileExtensionDisplayName(file.filename)}
                          {file.size
                            ? ` · ${(Number(file.size) / 1024).toFixed(1)} KB`
                            : ""}
                        </CardDescription>
                        <CardAction className="row-span-1 flex items-center gap-1 self-center">
                          <Button variant="ghost" size="icon-sm" asChild>
                            <a
                              href={downloadUrl(file.filename)}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <DownloadIcon className="size-4" />
                            </a>
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            disabled={deleteMutation.isPending}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(file.filename);
                            }}
                          >
                            <TrashIcon className="size-4" />
                          </Button>
                        </CardAction>
                      </CardHeader>
                    </Card>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      )}
    </SettingsSection>
  );
}
