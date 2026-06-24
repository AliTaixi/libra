"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  WorkspaceBody,
  WorkspaceContainer,
} from "@/components/workspace/workspace-container";
import { useI18n } from "@/core/i18n/hooks";
import { createCollection } from "@/core/knowledge-base/client";

export default function NewCollectionPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error(t.knowledgeBase.nameRequired);
      return;
    }

    setLoading(true);
    try {
      const collection = await createCollection({
        name: name.trim(),
        description: description.trim(),
      });
      toast.success(t.knowledgeBase.createSuccess);
      router.push(`/workspace/knowledge-base/collections/${collection.id}/upload`);
    } catch (err) {
      console.error("Failed to create collection:", err);
      toast.error(t.knowledgeBase.createFailed);
      setLoading(false);
    }
  };

  return (
    <WorkspaceContainer>
<WorkspaceBody>
        <div className="flex h-full w-full flex-col p-6">
          <div className="mb-6 flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => router.back()}>
              <ArrowLeft className="size-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold">{t.knowledgeBase.newPageTitle}</h1>
              <p className="text-muted-foreground mt-1 text-sm">
                {t.knowledgeBase.newPageDescription}
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="mx-auto w-full max-w-2xl">
            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">
                  {t.knowledgeBase.nameLabel} <span className="text-destructive">*</span>
                </label>
                <Input
                  placeholder={t.knowledgeBase.namePlaceholder}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">{t.knowledgeBase.descriptionLabel}</label>
                <Textarea
                  placeholder={t.knowledgeBase.descriptionPlaceholder}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                />
              </div>

              <div className="flex gap-3">
                <Button type="submit" disabled={loading}>
                  {loading && <Loader2 className="mr-2 size-4 animate-spin" />}
                  {t.knowledgeBase.createAndUpload}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => router.back()}
                  disabled={loading}
                >
                  {t.knowledgeBase.cancel}
                </Button>
              </div>
            </div>
          </form>
        </div>
      </WorkspaceBody>
    </WorkspaceContainer>
  );
}

