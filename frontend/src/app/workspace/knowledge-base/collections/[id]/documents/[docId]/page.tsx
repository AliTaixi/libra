"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  WorkspaceBody,
  WorkspaceContainer,
} from "@/components/workspace/workspace-container";
import { TreeViewer } from "@/components/knowledge-base/TreeViewer";
import type { KBTreeNode } from "@/core/knowledge-base/types";
import {
  getDocument,
  getDocumentTree,
  indexDocument,
} from "@/core/knowledge-base/client";
import type { KBDocument } from "@/core/knowledge-base/types";
import { useModels } from "@/core/models/hooks";

export default function DocumentDetailPage({
  params,
}: {
  params: Promise<{ id: string; docId: string }>;
}) {
  const router = useRouter();
  const { models } = useModels();
  const [collectionId, setCollectionId] = useState<string>("");
  const [documentId, setDocumentId] = useState<string>("");
  const [document, setDocument] = useState<KBDocument | null>(null);
  const [treeNodes, setTreeNodes] = useState<KBTreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [reindexing, setReindexing] = useState(false);

  useEffect(() => {
    params.then((p) => {
      setCollectionId(p.id);
      setDocumentId(p.docId);
    });
  }, [params]);

  useEffect(() => {
    if (!collectionId || !documentId) return;
    document.title = `${document?.title || "文档详情"} - 知识库 - Libra`;
  }, [collectionId, documentId, document?.title]);

  const fetchData = async () => {
    if (!collectionId || !documentId) return;
    setLoading(true);
    try {
      const [docRes, treeRes] = await Promise.all([
        getDocument(documentId),
        getDocumentTree(documentId).catch(() => null),
      ]);
      setDocument(docRes);
      if (treeRes) {
        setTreeNodes(treeRes.structure ?? []);
      }
    } catch (err) {
      console.error("获取文档详情失败:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [collectionId, documentId]);

  const handleReindex = async () => {
    if (!collectionId || !documentId) return;
    setReindexing(true);
    try {
      await indexDocument(documentId, models[0]?.name);
      toast.success("重新索引完成");
      fetchData();
    } catch (err) {
      console.error("重新索引失败:", err);
      toast.error("重新索引失败");
    } finally {
      setReindexing(false);
    }
  };

  const statusConfig: Record<KBDocument["status"], { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    pending: { label: "待处理", variant: "secondary" },
    indexing: { label: "索引中", variant: "default" },
    ready: { label: "就绪", variant: "outline" },
    failed: { label: "失败", variant: "destructive" },
  };

  if (loading && !document) {
    return (
      <WorkspaceContainer>
<WorkspaceBody>
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 size-5 animate-spin" />
            加载中...
          </div>
        </WorkspaceBody>
      </WorkspaceContainer>
    );
  }

  if (!document) {
    return (
      <WorkspaceContainer>
<WorkspaceBody>
          <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
            <p>文档不存在或已被删除</p>
            <Button
              variant="outline"
              onClick={() =>
                router.push(`/workspace/knowledge-base/collections/${collectionId}`)
              }
            >
              返回集合
            </Button>
          </div>
        </WorkspaceBody>
      </WorkspaceContainer>
    );
  }

  const status = statusConfig[document.status];

  return (
    <WorkspaceContainer>
<WorkspaceBody>
        <div className="flex h-full w-full flex-col p-6">
          <div className="mb-6 flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() =>
                router.push(`/workspace/knowledge-base/collections/${collectionId}`)
              }
            >
              <ArrowLeft className="size-5" />
            </Button>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold">{document.title}</h1>
                <Badge variant={status.variant}>{status.label}</Badge>
              </div>
              <p className="text-muted-foreground mt-1 text-sm">
                类型: {document.doc_type}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={handleReindex}
                disabled={reindexing}
              >
                {reindexing ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 size-4" />
                )}
                重新索引
              </Button>
            </div>
          </div>

          <div className="mb-6 flex gap-6">
            <div className="bg-card rounded-lg border px-4 py-3">
              <p className="text-muted-foreground text-xs">行数</p>
              <p className="text-2xl font-bold">{document.line_count ?? "-"}</p>
            </div>
            <div className="bg-card rounded-lg border px-4 py-3">
              <p className="text-muted-foreground text-xs">Token 数</p>
              <p className="text-2xl font-bold">{document.token_count ?? "-"}</p>
            </div>
            <div className="bg-card rounded-lg border px-4 py-3">
              <p className="text-muted-foreground text-xs">创建时间</p>
              <p className="text-sm font-medium">
                {new Date(document.created_at).toLocaleString()}
              </p>
            </div>
          </div>

          <Separator className="mb-6" />

          <div className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold">文档结构</h2>
            {treeNodes.length > 0 ? (
              <div className="bg-card rounded-lg border p-4">
                  <TreeViewer nodes={treeNodes} />
              </div>
            ) : (
              <div className="text-muted-foreground rounded-lg border p-8 text-center text-sm">
                暂无树形结构数据
              </div>
            )}
          </div>
        </div>
      </WorkspaceBody>
    </WorkspaceContainer>
  );
}
