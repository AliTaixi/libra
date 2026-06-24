"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

import {
  WorkspaceBody,
  WorkspaceContainer,
} from "@/components/workspace/workspace-container";
import { fetch as authFetch } from "@/core/api/fetcher";

import type { DrawioEditorHandle } from "@/components/drawio/drawio-editor";
import { DrawioEditor } from "@/components/drawio/drawio-editor";
import { DrawioPanel } from "@/components/drawio/drawio-panel";
import { EditorToolbar } from "@/components/drawio/editor-toolbar";
import { PreflowPage } from "@/components/drawio/preflow-page";

/** 编辑器阶段 */
type Phase = "preflow" | "editor";

export default function DrawioPage() {
  const editorRef = useRef<DrawioEditorHandle>(null);
  const [currentXml, setCurrentXml] = useState<string | undefined>(undefined);
  const [applying, setApplying] = useState(false);

  const [phase, setPhase] = useState<Phase>("preflow");
  const [diagramTitle, setDiagramTitle] = useState("绘图io");

  // ── 前置流程完成，进入编辑器 ──
  const handlePreflowStart = useCallback((xml: string, title: string) => {
    setDiagramTitle(title);
    setCurrentXml(xml);
    setPhase("editor");
    requestAnimationFrame(() => {
      setTimeout(async () => {
        try {
          await editorRef.current?.waitReady();
          editorRef.current?.loadXml(xml);
        } catch { /* 静默 */ }
      }, 500);
    });
  }, []);

  /** AI 应用 */
  const handleApplyXml = useCallback(async (xml: string) => {
    if (!editorRef.current) return;
    setApplying(true);
    try {
      await editorRef.current.waitReady();
      editorRef.current.loadXml(xml);
      setCurrentXml(xml);
    } catch { /* 静默 */ } finally { setApplying(false); }
  }, []);

  /** 编辑器变更 */
  const handleEditorChange = useCallback((xml: string) => {
    setCurrentXml(xml);
  }, []);

  /** 拦截 draw.io 内部 File → Save，保存到 user-data */
  const handleEditorSave = useCallback(async (xml: string) => {
    const filename = `${diagramTitle || "diagram"}.drawio`;
    try {
      const res = await authFetch(`/api/user/files/${encodeURIComponent(filename)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename, content: xml }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success("已保存到用户文件");
    } catch {
      toast.error("保存失败");
    }
  }, [diagramTitle]);

  // ── 前置页面 ──
  if (phase === "preflow") {
    return (
      <WorkspaceContainer>
        <WorkspaceBody className="!p-0">
          <PreflowPage onStart={handlePreflowStart} />
        </WorkspaceBody>
      </WorkspaceContainer>
    );
  }

  // ── 编辑器页面（70/30 分屏） ──
  return (
    <WorkspaceContainer>
      <WorkspaceBody className="!p-0 !items-stretch">
        <div className="flex flex-1 w-full overflow-hidden">
          <div className="flex flex-[7] flex-col min-w-0">
            <EditorToolbar fileName={diagramTitle} />
            <div className="relative flex-1 min-h-0">
              <DrawioEditor
                ref={editorRef}
                onChange={handleEditorChange}
                onSave={handleEditorSave}
                config={{ title: diagramTitle }}
              />
            </div>
          </div>
          <div className="flex-[3] flex flex-col min-w-0 border-l overflow-hidden">
            <DrawioPanel
              xmlCode={currentXml ?? ""}
              onGenerate={handleApplyXml}
              isApplying={applying}
            />
          </div>
        </div>
      </WorkspaceBody>
    </WorkspaceContainer>
  );
}
