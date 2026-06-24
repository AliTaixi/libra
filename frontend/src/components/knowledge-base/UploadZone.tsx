"use client";

import { useState, useCallback } from "react";
import { Upload } from "lucide-react";

import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface UploadZoneProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function UploadZone({ value, onChange, className }: UploadZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file && file.type === "text/markdown") {
        const reader = new FileReader();
        reader.onload = (event) => {
          if (event.target?.result) {
            onChange(event.target.result as string);
          }
        };
        reader.readAsText(file);
      }
    },
    [onChange],
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          if (event.target?.result) {
            onChange(event.target.result as string);
          }
        };
        reader.readAsText(file);
      }
    },
    [onChange],
  );

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div
        className={cn(
          "relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 transition-colors",
          isDragOver
            ? "border-primary bg-primary/5"
            : "border-muted-foreground/25 hover:border-muted-foreground/50",
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <Upload className="text-muted-foreground mb-2 size-8" />
        <p className="text-muted-foreground text-sm">拖拽 Markdown 文件到此处</p>
        <p className="text-muted-foreground text-xs">或点击选择文件</p>
        <input
          type="file"
          accept=".md,.markdown,text/markdown"
          className="absolute inset-0 cursor-pointer opacity-0"
          onChange={handleFileSelect}
        />
      </div>
      <Textarea
        placeholder="在此粘贴 Markdown 内容..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={12}
        className="font-mono text-sm"
      />
      {value && (
        <p className="text-muted-foreground text-xs">
          内容长度: {value.length} 字符
        </p>
      )}
    </div>
  );
}
