"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, FileText, Loader2, PenLine, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorName,
  ModelSelectorTrigger,
} from "@/components/ai-elements/model-selector";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  WorkspaceBody,
  WorkspaceContainer,
} from "@/components/workspace/workspace-container";
import { useI18n } from "@/core/i18n/hooks";
import { useModels } from "@/core/models/hooks";
import { deleteDraft, listDrafts } from "@/core/writing/api";
import type { DraftListResponse } from "@/core/writing/api";

export default function WritingDraftListPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [drafts, setDrafts] = useState<DraftListResponse["drafts"]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [modelDialogOpen, setModelDialogOpen] = useState(false);
  const [modelName, setModelName] = useState<string | undefined>();
  const { models } = useModels();

  const selectedModel = useMemo(() => {
    if (models.length === 0) return undefined;
    return models.find((m) => m.name === modelName) ?? models[0];
  }, [modelName, models]);

  useEffect(() => {
    document.title = `${t.writing.title} - Libra`;
  }, [t]);

  // 默认选中第一个模型
  useEffect(() => {
    if (!modelName && models.length > 0) {
      setModelName(models[0].name);
    }
  }, [models, modelName]);

  const fetchDrafts = async () => {
    setLoading(true);
    try {
      const res = await listDrafts(50, 0);
      if (res.success) {
        setDrafts(res.drafts);
      }
    } catch (err) {
      console.error("Failed to fetch drafts:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDrafts();
  }, []);

  const handleNewWriting = () => {
    const params = modelName ? `?model=${encodeURIComponent(modelName)}` : "";
    router.push(`/workspace/writing/new${params}`);
  };

  const handleOpenDraft = (draftId: number) => {
    router.push(`/workspace/writing/${draftId}`);
  };

  const handleDelete = async (draftId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(t.writing.deleteConfirm)) return;
    setDeleting(draftId);
    try {
      await deleteDraft(draftId);
      setDrafts((prev) => prev.filter((d) => d.id !== draftId));
      toast.success(t.writing.deleteSuccess);
    } catch {
      toast.error(t.writing.deleteFailed);
    } finally {
      setDeleting(null);
    }
  };

  return (
    <WorkspaceContainer>
      <WorkspaceBody>
        <div className="flex h-full w-full flex-col p-6">
          <div className="mb-6 flex items-center justify-between flex-wrap gap-2">
            <div>
              <h1 className="text-2xl font-bold">{t.writing.title}</h1>
              <p className="text-muted-foreground mt-1 text-sm">
                {t.writing.description}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <ModelSelector open={modelDialogOpen} onOpenChange={setModelDialogOpen}>
                <ModelSelectorTrigger asChild>
                  <Button variant="outline" size="sm">
                    <ModelSelectorName>{selectedModel?.display_name || t.writing.selectModel}</ModelSelectorName>
                  </Button>
                </ModelSelectorTrigger>
                <ModelSelectorContent>
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
                        <ModelSelectorName>{m.display_name}</ModelSelectorName>
                        <span className="text-muted-foreground truncate text-[10px]">{m.model}</span>
                        {m.name === modelName ? <CheckIcon className="ml-auto size-4" /> : <div className="ml-auto size-4" />}
                      </ModelSelectorItem>
                    ))}
                  </ModelSelectorList>
                </ModelSelectorContent>
              </ModelSelector>
              <Button onClick={handleNewWriting}>
                <Plus className="mr-2 size-4" />
                {t.writing.newButton}
              </Button>
            </div>
          </div>

          {loading ? (
            <div className="flex flex-1 items-center justify-center text-muted-foreground">
              <Loader2 className="mr-2 size-5 animate-spin" />
              {t.writing.loading}
            </div>
          ) : drafts.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 text-muted-foreground">
              <PenLine className="size-12 opacity-30" />
              <p className="text-lg">{t.writing.emptyTitle}</p>
              <p className="text-sm">{t.writing.emptyDescription}</p>
              <Button variant="outline" onClick={handleNewWriting}>
                <Plus className="mr-2 size-4" />
                {t.writing.newButton}
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {drafts.map((draft: Record<string, unknown>) => {
                const draftId = draft.id as number;
                const projectName = (draft.project_name as string) || t.writing.untitled;
                const docType = draft.doc_type as string;
                const stage = draft.stage as string;
                const updatedAt = draft.updated_at as string;
                const chapters = (draft.chapters as unknown[]) || [];
                const totalChapters = chapters.length;
                const chaptersWithContent = chapters.filter(
                  (ch: unknown) => (ch as Record<string, unknown>)?.content,
                ).length;

                const docTypeLabel = (() => {
                  switch (docType) {
                    case "report": return t.writing.docTypes.report;
                    case "proposal": return t.writing.docTypes.proposal;
                    case "thesis": return t.writing.docTypes.thesis;
                    case "manual": return t.writing.docTypes.manual;
                    case "spec": return t.writing.docTypes.spec;
                    default: return docType;
                  }
                })();

                return (
                  <Card
                    key={draftId}
                    className="cursor-pointer transition-shadow hover:shadow-md"
                    onClick={() => handleOpenDraft(draftId)}
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300">
                            <FileText className="size-5" />
                          </div>
                          <div>
                            <CardTitle className="truncate text-base">
                              {projectName}
                            </CardTitle>
                            <CardDescription className="text-xs">
                              {stage === "start" ? t.writing.stages.start :
                               stage === "writing" ? t.writing.stages.writing :
                               stage === "complete" ? t.writing.stages.complete : stage}
                            </CardDescription>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 shrink-0"
                          disabled={deleting === draftId}
                          onClick={(e) => handleDelete(draftId, e)}
                        >
                          {deleting === draftId ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Trash2 className="size-4" />
                          )}
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="pb-3">
                      <div className="flex gap-4 text-xs text-muted-foreground">
                        <span>
                          {t.writing.chapters}{chaptersWithContent}/{totalChapters}
                        </span>
                        <span>
                          {t.writing.updatedAt}{updatedAt ? new Date(updatedAt).toLocaleString() : "-"}
                        </span>
                      </div>
                    </CardContent>
                    <CardFooter className="pt-0">
                      <div className="flex flex-wrap gap-1">
                        <span className="rounded bg-yellow-100 px-1.5 py-0.5 text-[10px] font-medium text-yellow-700 dark:bg-yellow-800 dark:text-yellow-300">
                          {docTypeLabel}
                        </span>
                      </div>
                    </CardFooter>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </WorkspaceBody>
    </WorkspaceContainer>
  );
}
