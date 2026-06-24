"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckIcon, Loader2, Search, Zap } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  WorkspaceBody,
  WorkspaceContainer,
} from "@/components/workspace/workspace-container";
import { useModels } from "@/core/models/hooks";
import { listCollections, queryKnowledgeBase, queryKnowledgeBaseStream } from "@/core/knowledge-base/client";
import type { KBCollection, QueryRequest, QueryResponse, SSEEvent } from "@/core/knowledge-base/types";

const KB_MODEL_KEY = "kb-selected-model";

export default function QueryPage() {
  const [collections, setCollections] = useState<KBCollection[]>([]);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string>("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [result, setResult] = useState<QueryResponse | null>(null);
  const [streamText, setStreamText] = useState("");
  const [modelDialogOpen, setModelDialogOpen] = useState(false);
  const [modelName, setModelName] = useState<string | undefined>();
  const { models } = useModels();

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

  const handleModelSelect = (name: string) => {
    setModelName(name);
    localStorage.setItem(KB_MODEL_KEY, name);
    setModelDialogOpen(false);
  };

  useEffect(() => {
    document.title = "知识库查询 - Libra";
    const fetchCollections = async () => {
      try {
        const data = await listCollections();
        setCollections(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error("获取集合列表失败:", err);
        setCollections([]);
      }
    };
    fetchCollections();
  }, []);

  const handleSubmit = async () => {
    if (!query.trim()) {
      toast.error("请输入查询内容");
      return;
    }
    setLoading(true);
    setResult(null);
    setStreamText("");

    const req: QueryRequest = {
      query: query.trim(),
      ...(selectedCollectionId && { collection_ids: [selectedCollectionId] }),
      top_k: 5,
      model_name: modelName || undefined,
    };

    try {
      const res = await queryKnowledgeBase(req);
      setResult(res);
    } catch (err) {
      console.error("查询失败:", err);
      toast.error("查询失败");
    } finally {
      setLoading(false);
    }
  };

  const handleStream = async () => {
    if (!query.trim()) {
      toast.error("请输入查询内容");
      return;
    }
    setStreaming(true);
    setResult(null);
    setStreamText("");

    const req: QueryRequest = {
      query: query.trim(),
      ...(selectedCollectionId && { collection_ids: [selectedCollectionId] }),
      top_k: 5,
      model_name: modelName || undefined,
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
          toast.error("流式查询出错");
          setStreaming(false);
        },
        () => {
          setStreaming(false);
        },
      );
    } catch (err) {
      console.error("流式查询失败:", err);
      toast.error("流式查询失败");
      setStreaming(false);
    }
  };

  return (
    <WorkspaceContainer>
<WorkspaceBody>
        <div className="flex h-full w-full flex-col p-6">
          <div className="mb-6">
            <h1 className="text-2xl font-bold">知识库查询</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              向知识库提问，获取基于文档内容的智能回答
            </p>
          </div>

          <div className="mx-auto w-full max-w-3xl">
            <div className="flex flex-col gap-4">
              {/* Model selector */}
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">选择模型</label>
                <ModelSelector open={modelDialogOpen} onOpenChange={setModelDialogOpen}>
                  <ModelSelectorTrigger asChild>
                    <Button variant="outline" className="w-full justify-start">
                      <ModelSelectorName>{selectedModel?.display_name || "选择模型"}</ModelSelectorName>
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
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">选择集合</label>
                <Select
                  value={selectedCollectionId}
                  onValueChange={setSelectedCollectionId}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="全部集合" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">全部集合</SelectItem>
                    {collections.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">查询内容</label>
                <Textarea
                  placeholder="请输入你的问题..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  rows={4}
                />
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={handleSubmit}
                  disabled={loading || streaming || !query.trim()}
                >
                  {loading ? (
                    <Loader2 className="mr-2 size-4 animate-spin" />
                  ) : (
                    <Search className="mr-2 size-4" />
                  )}
                  查询
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
                <div className="bg-muted mt-4 rounded-lg border p-6">
                  <h3 className="mb-3 text-sm font-semibold">回答</h3>
                  <div className="text-sm leading-relaxed whitespace-pre-wrap">
                    {streamText || result?.answer}
                  </div>
                  {result?.sources && result.sources.length > 0 && (
                    <div className="mt-6">
                      <h4 className="mb-2 text-sm font-semibold">来源</h4>
                      <div className="flex flex-col gap-2">
                        {result.sources.map((source, idx) => (
                          <div
                            key={idx}
                            className="bg-background rounded border px-3 py-2 text-xs"
                          >
                            <span className="font-medium">{source.document_title}</span>
                            <span className="text-muted-foreground ml-2">
                              相关度: {(source.score * 100).toFixed(1)}%
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </WorkspaceBody>
    </WorkspaceContainer>
  );
}

