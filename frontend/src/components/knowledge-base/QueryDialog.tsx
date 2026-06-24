"use client";

import { useState } from "react";
import { Loader2, Search, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { queryKnowledgeBase, queryKnowledgeBaseStream } from "@/core/knowledge-base/client";
import type { QueryRequest, QueryResponse, SSEEvent } from "@/core/knowledge-base/types";

interface QueryDialogProps {
  collectionId?: string;
  documentId?: string;
  trigger?: React.ReactNode;
  className?: string;
}

export function QueryDialog({ collectionId, documentId, trigger, className }: QueryDialogProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [result, setResult] = useState<QueryResponse | null>(null);
  const [streamText, setStreamText] = useState("");

  const handleSubmit = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setResult(null);
    setStreamText("");

    const req: QueryRequest = {
      query: query.trim(),
      ...(collectionId && { collection_ids: [collectionId] }),
      ...(documentId && { document_ids: [documentId] }),
      top_k: 5,
    };

    try {
      const res = await queryKnowledgeBase(req);
      setResult(res);
    } catch (err) {
      console.error("查询失败:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleStream = async () => {
    if (!query.trim()) return;
    setStreaming(true);
    setResult(null);
    setStreamText("");

    const req: QueryRequest = {
      query: query.trim(),
      ...(collectionId && { collection_ids: [collectionId] }),
      ...(documentId && { document_ids: [documentId] }),
      top_k: 5,
    };

    try {
      await queryKnowledgeBaseStream(
        req,
        (event: SSEEvent) => {
          if (event.event === "token") {
            setStreamText((prev) => prev + event.data);
          }
        },
        (err: Error) => {
          console.error("流式查询错误:", err);
          setStreaming(false);
        },
        () => {
          setStreaming(false);
        },
      );
    } catch (err) {
      console.error("流式查询失败:", err);
      setStreaming(false);
    }
  };

  const handleClose = () => {
    setOpen(false);
    setQuery("");
    setResult(null);
    setStreamText("");
    setLoading(false);
    setStreaming(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" className={className}>
            <Search className="mr-2 size-4" />
            查询
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>知识库查询</DialogTitle>
          <DialogDescription>输入问题，从知识库中获取答案</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Textarea
            placeholder="请输入你的问题..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            rows={3}
          />
          <div className="flex gap-2">
            <Button onClick={handleSubmit} disabled={loading || streaming || !query.trim()}>
              {loading ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Search className="mr-2 size-4" />
              )}
              提交查询
            </Button>
            <Button
              variant="secondary"
              onClick={handleStream}
              disabled={loading || streaming || !query.trim()}
            >
              {streaming ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Zap className="mr-2 size-4" />
              )}
              流式查询
            </Button>
          </div>

          {(result || streamText) && (
            <div className="bg-muted mt-2 rounded-lg border p-4">
              <h4 className="mb-2 text-sm font-semibold">回答</h4>
              <div className="text-sm leading-relaxed whitespace-pre-wrap">
                {streamText || result?.answer}
              </div>
              {result?.sources && result.sources.length > 0 && (
                <div className="mt-4">
                  <h4 className="mb-1 text-sm font-semibold">来源</h4>
                  <div className="flex flex-wrap gap-2">
                    {result.sources.map((source, idx) => (
                      <span
                        key={idx}
                        className="bg-background rounded border px-2 py-1 text-xs"
                      >
                        {source.document_title}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
