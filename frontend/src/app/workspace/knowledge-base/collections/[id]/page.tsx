"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Plus, Search, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  WorkspaceBody,
  WorkspaceContainer,
} from "@/components/workspace/workspace-container";
import { useI18n } from "@/core/i18n/hooks";
import { DocumentRow } from "@/components/knowledge-base/DocumentRow";
import {
  getCollection,
  listDocuments,
} from "@/core/knowledge-base/client";
import type { KBCollection, KBDocument } from "@/core/knowledge-base/types";

export default function CollectionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { t } = useI18n();
  const router = useRouter();
  const [collectionId, setCollectionId] = useState<string>("");
  const [collection, setCollection] = useState<KBCollection | null>(null);
  const [documents, setDocuments] = useState<KBDocument[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    params.then((p) => setCollectionId(p.id));
  }, [params]);

  useEffect(() => {
    if (!collectionId) return;
    document.title = `${collection?.name || t.knowledgeBase.title} - Libra`;
  }, [collectionId, collection?.name, t]);

  const fetchData = async () => {
    if (!collectionId) return;
    setLoading(true);
    try {
      const [colRes, docsRes] = await Promise.all([
        getCollection(collectionId),
        listDocuments(collectionId),
      ]);
      setCollection(colRes);
      setDocuments(Array.isArray(docsRes) ? docsRes : []);
    } catch (err) {
      console.error("Failed to fetch collection:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [collectionId]);

  if (loading && !collection) {
    return (
      <WorkspaceContainer>
<WorkspaceBody>
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 size-5 animate-spin" />
            {t.knowledgeBase.loading}
          </div>
        </WorkspaceBody>
      </WorkspaceContainer>
    );
  }

  if (!collection) {
    return (
      <WorkspaceContainer>
<WorkspaceBody>
          <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
            <p>{t.knowledgeBase.collectionNotFound}</p>
            <Button variant="outline" onClick={() => router.push("/workspace/knowledge-base")}>
              {t.knowledgeBase.backToHome}
            </Button>
          </div>
        </WorkspaceBody>
      </WorkspaceContainer>
    );
  }

  return (
    <WorkspaceContainer>
<WorkspaceBody>
        <div className="flex h-full w-full flex-col p-6">
          <div className="mb-6 flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => router.push("/workspace/knowledge-base")}
            >
              <ArrowLeft className="size-5" />
            </Button>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold">{collection.name}</h1>
                <Badge variant="secondary">{collection.document_count} {t.knowledgeBase.docCount}</Badge>
              </div>
              <p className="text-muted-foreground mt-1 text-sm">
                {collection.description || t.knowledgeBase.noDescription}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() =>
                  router.push(`/workspace/knowledge-base/collections/${collectionId}/upload`)
                }
              >
                <Upload className="mr-2 size-4" />
                {t.knowledgeBase.uploadDoc}
              </Button>
            </div>
          </div>

          {documents.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 text-muted-foreground">
              <Search className="size-12 opacity-30" />
              <p className="text-lg">{t.knowledgeBase.noDocuments}</p>
              <p className="text-sm">{t.knowledgeBase.noDocumentsHint}</p>
              <Button
                onClick={() =>
                  router.push(`/workspace/knowledge-base/collections/${collectionId}/upload`)
                }
              >
                <Plus className="mr-2 size-4" />
                {t.knowledgeBase.uploadDoc}
              </Button>
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="px-4 py-3 font-medium">{t.knowledgeBase.tableTitle}</th>
                    <th className="px-4 py-3 font-medium">{t.knowledgeBase.tableType}</th>
                    <th className="px-4 py-3 font-medium">{t.knowledgeBase.tableStatus}</th>
                    <th className="px-4 py-3 font-medium">{t.knowledgeBase.tableCreatedAt}</th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((doc) => (
                    <DocumentRow
                      key={doc.id}
                      document={doc}
                      onDeleted={fetchData}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </WorkspaceBody>
    </WorkspaceContainer>
  );
}
