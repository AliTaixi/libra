"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BookOpen, CheckIcon, Loader2, Plus } from "lucide-react";

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
  WorkspaceBody,
  WorkspaceContainer,
} from "@/components/workspace/workspace-container";
import { CollectionCard } from "@/components/knowledge-base/CollectionCard";
import { useI18n } from "@/core/i18n/hooks";
import { useModels } from "@/core/models/hooks";
import { listCollections } from "@/core/knowledge-base/client";
import type { KBCollection } from "@/core/knowledge-base/types";

const KB_MODEL_KEY = "kb-selected-model";

export default function KnowledgeBaseHomePage() {
  const { t } = useI18n();
  const { models } = useModels();
  const [modelName, setModelName] = useState<string | undefined>();
  const [modelDialogOpen, setModelDialogOpen] = useState(false);

  const selectedModel = useMemo(() => {
    if (models.length === 0) return undefined;
    return models.find((m) => m.name === modelName) ?? models[0];
  }, [modelName, models]);

  // 初始化：优先读 localStorage，其次选第一个模型
  useEffect(() => {
    if (models.length === 0) return;
    const saved = localStorage.getItem(KB_MODEL_KEY);
    if (saved && models.some((m) => m.name === saved)) {
      setModelName(saved);
    } else {
      setModelName(models[0].name);
    }
  }, [models]);

  // 选中模型时持久化到 localStorage
  const handleModelSelect = (name: string) => {
    setModelName(name);
    localStorage.setItem(KB_MODEL_KEY, name);
    setModelDialogOpen(false);
  };
  const [collections, setCollections] = useState<KBCollection[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = `${t.knowledgeBase.title} - Libra`;
  }, [t]);

  useEffect(() => {
    const fetchCollections = async () => {
      setLoading(true);
      try {
        const data = await listCollections();
        setCollections(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error("Failed to fetch collections:", err);
        setCollections([]);
      } finally {
        setLoading(false);
      }
    };
    fetchCollections();
  }, []);

  const totalDocuments = collections.reduce((sum, c) => sum + c.document_count, 0);

  return (
    <WorkspaceContainer>
<WorkspaceBody>
        <div className="flex h-full w-full flex-col p-6">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">{t.knowledgeBase.title}</h1>
              <p className="text-muted-foreground mt-1 text-sm">
                {t.knowledgeBase.description}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {models.length > 0 && (
                <ModelSelector open={modelDialogOpen} onOpenChange={setModelDialogOpen}>
                  <ModelSelectorTrigger asChild>
                    <Button variant="outline" size="sm">
                      <ModelSelectorName>
                        {selectedModel?.display_name ?? t.writing.selectModel}
                      </ModelSelectorName>
                    </Button>
                  </ModelSelectorTrigger>
                  <ModelSelectorContent>
                    <ModelSelectorList>
                      {models.map((m) => (
                        <ModelSelectorItem
                          key={m.name}
                          value={m.name}
                          onSelect={() => handleModelSelect(m.name)}
                        >
                          <ModelSelectorName>{m.display_name}</ModelSelectorName>
                          <span className="text-muted-foreground truncate text-[10px]">{m.model}</span>
                          {m.name === modelName ? <CheckIcon className="ml-auto size-4" /> : <div className="ml-auto size-4" />}
                        </ModelSelectorItem>
                      ))}
                    </ModelSelectorList>
                  </ModelSelectorContent>
                </ModelSelector>
              )}
              <Button asChild>
                <Link href="/workspace/knowledge-base/new">
                  <Plus className="mr-2 size-4" />
                  {t.knowledgeBase.newCollection}
                </Link>
              </Button>
            </div>
          </div>

          {loading ? (
            <div className="flex flex-1 items-center justify-center text-muted-foreground">
              <Loader2 className="mr-2 size-5 animate-spin" />
              {t.knowledgeBase.loading}
            </div>
          ) : collections.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 text-muted-foreground">
              <BookOpen className="size-12 opacity-30" />
              <p className="text-lg">{t.knowledgeBase.emptyTitle}</p>
              <p className="text-sm">{t.knowledgeBase.emptyDescription}</p>
              <Button asChild>
                <Link href="/workspace/knowledge-base/new">
                  <Plus className="mr-2 size-4" />
                  {t.knowledgeBase.createButton}
                </Link>
              </Button>
            </div>
          ) : (
            <>
              <div className="mb-6 flex gap-6">
                <div className="bg-card rounded-lg border px-4 py-3">
                  <p className="text-muted-foreground text-xs">{t.knowledgeBase.collectionCount}</p>
                  <p className="text-2xl font-bold">{collections.length}</p>
                </div>
                <div className="bg-card rounded-lg border px-4 py-3">
                  <p className="text-muted-foreground text-xs">{t.knowledgeBase.documentCount}</p>
                  <p className="text-2xl font-bold">{totalDocuments}</p>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {collections.map((collection) => (
                  <CollectionCard
                    key={collection.id}
                    collection={collection}
                    onDelete={() => {
                      const fetchCollections = async () => {
                        try {
                          const data = await listCollections();
                          setCollections(Array.isArray(data) ? data : []);
                        } catch {
                          setCollections([]);
                        }
                      };
                      fetchCollections();
                    }}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </WorkspaceBody>
    </WorkspaceContainer>
  );
}

