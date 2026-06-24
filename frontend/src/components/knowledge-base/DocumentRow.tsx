"use client";

import { useState } from "react";
import { Download, FileText, Loader2, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { deleteDocument, getDownloadUrl } from "@/core/knowledge-base/client";
import type { KBDocument } from "@/core/knowledge-base/types";

interface DocumentRowProps {
  document: KBDocument;
  className?: string;
  onDeleted?: () => void;
}

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending: { label: "待处理", variant: "secondary" },
  indexing: { label: "索引中", variant: "default" },
  ready: { label: "就绪", variant: "outline" },
  failed: { label: "失败", variant: "destructive" },
};

export function DocumentRow({ document, className, onDeleted }: DocumentRowProps) {
  const [deleting, setDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const status = statusConfig[document.status] || { label: document.status, variant: "secondary" };

  const handleDownload = () => {
    window.open(getDownloadUrl(document.id), "_blank");
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmOpen(true);
  };

  const confirmDelete = async () => {
    setDeleting(true);
    try {
      await deleteDocument(document.id);
      setConfirmOpen(false);
      onDeleted?.();
    } catch (err) {
      console.error("删除失败:", err);
      setDeleting(false);
    }
  };

  return (
    <>
      <tr className={cn("border-b transition-colors hover:bg-muted/50", className)}>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <FileText className="text-muted-foreground size-4" />
            <span className="truncate text-sm font-medium">{document.title}</span>
          </div>
        </td>
        <td className="px-4 py-3">
          <span className="text-muted-foreground text-sm">{document.doc_type}</span>
        </td>
        <td className="px-4 py-3">
          <Badge variant={status.variant}>{status.label}</Badge>
        </td>
        <td className="text-muted-foreground px-4 py-3 text-sm">
          {new Date(document.created_at).toLocaleString()}
        </td>
        <td className="px-4 py-3 text-right">
          <div className="flex items-center justify-end gap-1">
            <Button variant="ghost" size="icon" className="size-8" onClick={handleDownload} title="下载文档">
              <Download className="size-4" />
            </Button>
            <Button variant="ghost" size="icon" className="size-8" onClick={handleDeleteClick} title="删除文档">
              <Trash2 className="size-4 text-destructive" />
            </Button>
          </div>
        </td>
      </tr>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription>
              确定要删除文档「{document.title}」吗？此操作不可恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">取消</Button>
            </DialogClose>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
              {deleting && <Loader2 className="mr-2 size-4 animate-spin" />}
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
