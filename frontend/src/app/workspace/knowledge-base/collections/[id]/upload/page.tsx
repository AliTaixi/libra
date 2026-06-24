"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, File, FileText, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  WorkspaceBody,
  WorkspaceContainer,
} from "@/components/workspace/workspace-container";
import { useI18n } from "@/core/i18n/hooks";
import { useModels } from "@/core/models/hooks";
import {
  createDocument,
  getCollection,
  uploadDocumentContent,
  uploadDocumentFile,
} from "@/core/knowledge-base/client";
import type { KBCollection } from "@/core/knowledge-base/types";

export default function UploadDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { t } = useI18n();
  const { models } = useModels();
  const router = useRouter();
  const [collectionId, setCollectionId] = useState<string>("");
  const [collection, setCollection] = useState<KBCollection | null>(null);
  const [title, setTitle] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [textContent, setTextContent] = useState("");
  const [inputMode, setInputMode] = useState<"file" | "text">("file");
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    params.then((p) => setCollectionId(p.id));
  }, [params]);

  useEffect(() => {
    if (!collectionId) return;
    getCollection(collectionId)
      .then(setCollection)
      .catch(() => {});
  }, [collectionId]);

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      setSelectedFile(file);
      setTitle(file.name.replace(/\.[^.]+$/, ""));
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setTitle(file.name.replace(/\.[^.]+$/, ""));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.error(t.knowledgeBase.titleRequired);
      return;
    }
    if (!collectionId) return;

    setLoading(true);
    try {
      const modelName = models[0]?.name;
      const doc = await createDocument(collectionId, {
        title: title.trim(),
        doc_type: selectedFile ? (selectedFile.name.endsWith(".pdf") ? "pdf" : "md") : "md",
        model_name: modelName,
      });

      if (inputMode === "file" && selectedFile) {
        const ext = selectedFile.name.split(".").pop()?.toLowerCase();
        if (ext === "md" || ext === "markdown" || ext === "txt") {
          const text = await selectedFile.text();
          await uploadDocumentContent(doc.id, {
            content: text,
            filename: selectedFile.name,
            model_name: modelName,
          });
        } else {
          await uploadDocumentFile(doc.id, selectedFile, modelName);
        }
      } else if (textContent.trim()) {
        await uploadDocumentContent(doc.id, {
          content: textContent.trim(),
          filename: `${title}.md`,
          model_name: modelName,
        });
      } else {
        toast.error(t.knowledgeBase.contentRequired);
        setLoading(false);
        return;
      }

      toast.success(t.knowledgeBase.uploadSuccess);
      router.push(`/workspace/knowledge-base/collections/${collectionId}`);
    } catch (err) {
      console.error("Upload failed:", err);
      toast.error(err instanceof Error ? err.message : t.knowledgeBase.uploadFailed);
      setLoading(false);
    }
  };

  const acceptedFormats = ".pdf,.md,.markdown,.txt,.docx,.doc,.pptx,.ppt";

  return (
    <WorkspaceContainer>
<WorkspaceBody>
        <div className="flex h-full w-full flex-col p-6">
          <div className="mb-6 flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => router.back()}>
              <ArrowLeft className="size-4" />
            </Button>
            <div>
              <h1 className="text-xl font-bold">{t.knowledgeBase.uploadTitle}</h1>
              <p className="text-muted-foreground text-sm">
                {collection ? `${t.knowledgeBase.uploadTo}: ${collection.name}` : ""}
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="mx-auto w-full max-w-2xl space-y-6">
            <div className="space-y-2">
              <label htmlFor="title" className="text-sm font-medium">{t.knowledgeBase.documentTitle}</label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t.knowledgeBase.documentTitlePlaceholder}
                required
              />
            </div>

            <div className="flex gap-2">
              <Button
                type="button"
                variant={inputMode === "file" ? "default" : "outline"}
                size="sm"
                onClick={() => setInputMode("file")}
              >
                <Upload className="mr-1 size-4" />
                {t.knowledgeBase.fileUpload}
              </Button>
              <Button
                type="button"
                variant={inputMode === "text" ? "default" : "outline"}
                size="sm"
                onClick={() => setInputMode("text")}
              >
                <FileText className="mr-1 size-4" />
                {t.knowledgeBase.pasteContent}
              </Button>
            </div>

            {inputMode === "file" && (
              <div
                className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 transition-colors ${
                  dragOver
                    ? "border-primary bg-primary/5"
                    : "border-muted-foreground/25 hover:border-muted-foreground/50"
                }`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleFileDrop}
              >
                {selectedFile ? (
                  <div className="flex flex-col items-center gap-3">
                    <File className="size-10 text-muted-foreground" />
                    <p className="font-medium">{selectedFile.name}</p>
                    <p className="text-muted-foreground text-sm">
                      {(selectedFile.size / 1024).toFixed(1)} KB
                    </p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedFile(null)}
                    >
                      {t.knowledgeBase.reselect}
                    </Button>
                  </div>
                ) : (
                  <>
                    <Upload className="mb-4 size-10 text-muted-foreground" />
                    <p className="mb-2 text-sm font-medium">
                      {t.knowledgeBase.dragDropHint}
                    </p>
                    <p className="text-muted-foreground mb-4 text-xs">
                      {t.knowledgeBase.supportedFormats}
                    </p>
                    <label>
                      <Button type="button" variant="outline" asChild>
                        <span>{t.knowledgeBase.selectFile}</span>
                      </Button>
                      <input
                        type="file"
                        className="hidden"
                        accept={acceptedFormats}
                        onChange={handleFileSelect}
                      />
                    </label>
                  </>
                )}
              </div>
            )}

            {inputMode === "text" && (
              <div className="space-y-2">
                <label htmlFor="content" className="text-sm font-medium">{t.knowledgeBase.markdownContent}</label>
                <textarea
                  id="content"
                  className="border-input focus-visible:border-ring focus-visible:ring-ring/50 flex min-h-[300px] w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px]"
                  value={textContent}
                  onChange={(e) => setTextContent(e.target.value)}
                  placeholder={t.knowledgeBase.markdownPlaceholder}
                />
              </div>
            )}

            <div className="flex gap-3">
              <Button type="submit" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    {t.knowledgeBase.uploading}
                  </>
                ) : (
                  t.knowledgeBase.uploadAndIndex
                )}
              </Button>
              <Button type="button" variant="outline" onClick={() => router.back()}>
                {t.knowledgeBase.cancel}
              </Button>
            </div>
          </form>
        </div>
      </WorkspaceBody>
    </WorkspaceContainer>
  );
}
