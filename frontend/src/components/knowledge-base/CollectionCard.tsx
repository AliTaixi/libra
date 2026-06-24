"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FolderOpen, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { deleteCollection } from "@/core/knowledge-base/client";
import type { KBCollection } from "@/core/knowledge-base/types";

interface CollectionCardProps {
  collection: KBCollection;
  className?: string;
  onDelete?: () => void;
}

export function CollectionCard({ collection, className, onDelete }: CollectionCardProps) {
  const router = useRouter();
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteCollection(collection.id);
      toast.success(`集合"${collection.name}"已删除`);
      setShowDelete(false);
      onDelete?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <Card
        className={cn("group cursor-pointer transition-shadow hover:shadow-md", className)}
        onClick={() => router.push(`/workspace/knowledge-base/collections/${collection.id}`)}
      >
        <CardHeader className="pb-3">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
              <FolderOpen className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <CardTitle className="truncate text-base">{collection.name}</CardTitle>
              <CardDescription className="text-xs">
                {collection.document_count} 个文档
              </CardDescription>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e) => {
                e.stopPropagation();
                setShowDelete(true);
              }}
              title="删除集合"
            >
              <Trash2 className="size-4 text-destructive" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground line-clamp-2 text-sm">
            {collection.description || "暂无描述"}
          </p>
        </CardContent>
      </Card>

      <Dialog open={showDelete} onOpenChange={setShowDelete}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>删除集合</DialogTitle>
            <DialogDescription>
              确定要删除集合「{collection.name}」吗？集合内的所有文档和索引将被永久删除，此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDelete(false)} disabled={deleting}>
              取消
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? <><Loader2 className="mr-2 size-4 animate-spin" /> 删除中...</> : "确认删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
