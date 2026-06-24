"use client";

import {
  BrainIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@/components/ui/item";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/core/i18n/hooks";
import {
  useCreateModel,
  useDeleteModel,
  useModels,
  useUpdateModel,
} from "@/core/models/hooks";
import type { Model } from "@/core/models/types";

import { SettingsSection } from "./settings-section";

// ── Provider presets ──────────────────────────────────────────────
function detectProvider(use?: string): string {
  if (!use) return "openai";
  if (use.includes("ChatOllama")) return "ollama";
  return "openai";
}

const PROVIDERS = [
  {
    value: "openai",
    label: "OpenAI",
    use: "langchain_openai:ChatOpenAI",
    needKey: true,
    defaultBaseUrl: "",
  },
  {
    value: "ollama",
    label: "Ollama（本地）",
    use: "langchain_ollama:ChatOllama",
    needKey: false,
    defaultBaseUrl: "http://host.docker.internal:11434",
  },
  {
    value: "custom",
    label: "自定义",
    use: "langchain_openai:ChatOpenAI",
    needKey: true,
    defaultBaseUrl: "",
  },
] as const;

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-|-$/g, "")
    || "model";
}

// ── Page ──────────────────────────────────────────────────────────
export function ModelsSettingsPage() {
  const { t } = useI18n();
  const { models, isLoading, error } = useModels();
  return (
    <SettingsSection
      title={t.settings.models.title}
      description={t.settings.models.description}
    >
      {isLoading ? (
        <div className="text-muted-foreground text-sm">{t.common.loading}</div>
      ) : error ? (
        <div>Error: {error.message}</div>
      ) : (
        <ModelsList models={models} />
      )}
    </SettingsSection>
  );
}

// ── List ──────────────────────────────────────────────────────────
function ModelsList({ models }: { models: Model[] }) {
  const { t } = useI18n();
  const { mutate: doDelete } = useDeleteModel();
  const [showAdd, setShowAdd] = useState(false);
  const [editTarget, setEditTarget] = useState<Model | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  return (
    <div className="flex w-full flex-col gap-4">
      <header className="flex justify-between items-center">
        <h3 className="text-sm font-medium text-muted-foreground">
          {models.length} 个模型
        </h3>
        <Button size="sm" onClick={() => setShowAdd(true)}>
          <PlusIcon className="size-4 mr-1" />
          {t.settings.models.addButton}
        </Button>
      </header>

      {models.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BrainIcon />
            </EmptyMedia>
            <EmptyTitle>{t.settings.models.empty}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="space-y-2">
          {models.map((model) => (
            <Item className="w-full" variant="outline" key={model.name}>
              <ItemContent>
                <ItemTitle>
                  <div className="flex items-center gap-2">
                    <BrainIcon className="size-4 text-muted-foreground shrink-0" />
                    <span>{model.display_name || model.name}</span>
                  </div>
                </ItemTitle>
                <ItemDescription className="line-clamp-2">
                  {model.name} — {model.model}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <div className="flex items-center gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 shrink-0"
                    onClick={() => setEditTarget(model)}
                    title={t.settings.models.editButton}
                  >
                    <PencilIcon className="size-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="text-destructive hover:text-destructive h-8 w-8 shrink-0"
                    onClick={() => setDeleteTarget(model.name)}
                    title={t.settings.models.deleteButton}
                  >
                    <Trash2Icon className="size-3.5" />
                  </Button>
                </div>
              </ItemActions>
            </Item>
          ))}
        </div>
      )}

      <ModelFormDialog
        open={showAdd}
        onOpenChange={(open) => setShowAdd(open)}
        mode="add"
      />

      <ModelFormDialog
        open={!!editTarget}
        onOpenChange={(open) => !open && setEditTarget(null)}
        mode="edit"
        initialData={editTarget}
      />

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{t.settings.models.deleteButton}</DialogTitle>
            <DialogDescription>
              {t.settings.models.deleteConfirm.replace("{name}", deleteTarget || "")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              {t.common.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (!deleteTarget) return;
                doDelete(deleteTarget, {
                  onSuccess: () => {
                    toast.success(t.settings.models.deleteSuccess);
                    setDeleteTarget(null);
                  },
                  onError: (err) => {
                    toast.error(err instanceof Error ? err.message : "删除失败");
                  },
                });
              }}
            >
              {t.settings.models.deleteButton}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Form Dialog ───────────────────────────────────────────────────
function ModelFormDialog({
  open,
  onOpenChange,
  mode,
  initialData,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "add" | "edit";
  initialData?: Model | null;
}) {
  const { t } = useI18n();
  const { mutate: createModel, isPending: isCreating } = useCreateModel();
  const { mutate: updateModel, isPending: isUpdating } = useUpdateModel();
  const isPending = isCreating || isUpdating;

  // Form state
  const [provider, setProvider] = useState("openai");
  const [displayName, setDisplayName] = useState("");
  const [modelName, setModelName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");

  // Initialize form when dialog opens
  useEffect(() => {
    if (open) {
      if (mode === "add") {
        setProvider("openai");
        setDisplayName("");
        setModelName("");
        setApiKey("");
        setBaseUrl("");
      } else if (initialData) {
        setProvider(detectProvider(initialData.use));
        setDisplayName(initialData.display_name || initialData.name);
        setModelName(initialData.model);
        setApiKey("");
        setBaseUrl("");
      }
    }
  }, [open, mode, initialData]);

  const selectedProvider = PROVIDERS.find((p) => p.value === provider)!;

  const handleSubmit = () => {
    if (!displayName.trim() || !modelName.trim()) return;

    const body = {
      name: slugify(displayName),
      model: modelName.trim(),
      display_name: displayName.trim(),
      use: selectedProvider.use,
      api_key: apiKey.trim() || undefined,
      base_url: baseUrl.trim() || selectedProvider.defaultBaseUrl || undefined,
      supports_vision: true,
    };

    if (mode === "add") {
      createModel(body, {
        onSuccess: () => {
          toast.success(t.settings.models.addSuccess);
          onOpenChange(false);
        },
        onError: (err) => {
          toast.error(err instanceof Error ? err.message : "添加失败");
        },
      });
    } else {
      updateModel(
        {
          name: initialData!.name,
          body: {
            model: modelName.trim() || undefined,
            display_name: displayName.trim() || undefined,
            use: selectedProvider.use,
            api_key: apiKey.trim() || undefined,
      base_url: baseUrl.trim() || selectedProvider.defaultBaseUrl || undefined,
            supports_vision: true,
          },
        },
        {
          onSuccess: () => {
            toast.success(t.settings.models.updateSuccess);
            onOpenChange(false);
          },
          onError: (err) => {
            toast.error(err instanceof Error ? err.message : "编辑失败");
          },
        },
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>
            {mode === "add" ? t.settings.models.addButton : t.settings.models.editButton}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* Provider */}
          <div className="grid gap-1.5">
            <label className="text-sm font-medium">提供者</label>
            <Select value={provider} onValueChange={setProvider}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVIDERS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Display Name */}
          <div className="grid gap-1.5">
            <label className="text-sm font-medium">名称</label>
            <Input
              placeholder="例如: GPT-4o、Gemma 4"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
            {mode === "add" && displayName.trim() && (
              <p className="text-xs text-muted-foreground">
                标识: {slugify(displayName)}
              </p>
            )}
          </div>

          {/* Model Name */}
          <div className="grid gap-1.5">
            <label className="text-sm font-medium">模型名</label>
            <Input
              placeholder={
                provider === "ollama"
                  ? "例如: gemma4:31b-cloud"
                  : "例如: gpt-4o"
              }
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {provider === "ollama"
                ? "你本地用 ollama pull 的模型名称"
                : "提供者那边的模型 ID"}
            </p>
          </div>

          {/* API Key — only for providers that need it */}
          {selectedProvider.needKey && (
            <div className="grid gap-1.5">
              <label className="text-sm font-medium">API 密钥</label>
              <Input
                type="password"
                placeholder="不填则使用环境变量中已有的密钥"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                留空则沿用已有的环境变量配置
              </p>
            </div>
          )}

          {/* Base URL */}
          <div className="grid gap-1.5">
            <label className="text-sm font-medium">API 地址</label>
            <Input
              placeholder={selectedProvider.defaultBaseUrl || "例如: https://api.openai.com/v1"}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
            {provider === "ollama" && !baseUrl && (
              <p className="text-xs text-muted-foreground">
                留空默认: http://host.docker.internal:11434
              </p>
            )}
          </div>

        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t.common.cancel}
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isPending || !displayName.trim() || !modelName.trim()}
          >
            {isPending
              ? t.common.loading
              : mode === "add"
                ? t.settings.models.addButton
                : t.settings.models.editButton}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
