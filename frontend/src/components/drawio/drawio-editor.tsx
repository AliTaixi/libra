"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

import { DrawioBridge } from "@/core/drawio/bridge";
import type { DrawioEmbedConfig, DrawioMessageEvent } from "@/core/drawio/types";

export interface DrawioEditorHandle {
  /** 加载图表 XML */
  loadXml: (xml: string) => void;
  /** 导出当前图表为 XML */
  exportXml: () => Promise<string>;
  /** 保存 */
  save: () => void;
  /** 等待 iframe 就绪 */
  waitReady: () => Promise<void>;
  /** 获取桥接实例（直接操作） */
  bridge: DrawioBridge | null;
}

interface DrawioEditorProps {
  /** 嵌入配置 */
  config?: DrawioEmbedConfig;
  /** 编辑器就绪回调 */
  onReady?: () => void;
  /** 图表变更回调（用户手动编辑后触发） */
  onChange?: (xml: string) => void;
  /** 标题变更 */
  onTitleChange?: (title: string) => void;
  /** 用户点击 File → Save 时触发 */
  onSave?: (xml: string) => void;
  /** ref 暴露控制方法 */
  ref?: React.Ref<DrawioEditorHandle>;
}

/**
 * draw.io 编辑器 iframe 封装组件
 *
 * 嵌入 draw.io 在线编辑器，提供完整的图表编辑功能。
 * 通过 postMessage 与 iframe 通信，支持加载/导出/保存图表。
 */
export function DrawioEditor({
  config,
  onReady,
  onChange,
  onTitleChange,
  onSave,
  ref,
}: DrawioEditorProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const bridgeRef = useRef<DrawioBridge | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const readyRef = useRef(false);

  // draw.io 服务地址
  const baseUrl = config?.baseUrl ?? "http://localhost:8010";

  // 组装 URL 参数：嵌入模式，显示完整左侧形状面板
  const embedUrl = useCallback(() => {
    const params = new URLSearchParams({
      embed: "1",
      spin: "1",
      proto: "json",
    });
    if (config?.title) {
      params.set("title", config.title);
    }
    return `${baseUrl}?${params.toString()}`;
  }, [baseUrl, config?.title]);

  // 初始化桥梁
  useEffect(() => {
    const bridge = new DrawioBridge(() => iframeRef.current);
    bridgeRef.current = bridge;

    bridge.on("init", () => {
      setLoading(false);
      readyRef.current = true;
      onReady?.();
    });

    bridge.on("save", (msg: DrawioMessageEvent) => {
      if (msg.xml) {
        onChange?.(msg.xml);
        onSave?.(msg.xml);
      }
    });

    bridge.on("dirty", () => {
      // 图表被修改的标志，可用来显示"未保存"提示
    });

    bridge.on("title", (msg: DrawioMessageEvent) => {
      if (msg.title && onTitleChange) {
        onTitleChange(msg.title);
      }
    });

    return () => {
      bridge.destroy();
      bridgeRef.current = null;
      readyRef.current = false;
    };
  }, [onChange, onTitleChange, onReady, onSave]);

  // 暴露控制方法给父组件
  useImperativeHandle(
    ref,
    () =>
      ({
        loadXml: (xml: string) => {
          bridgeRef.current?.loadXml(xml);
        },
        exportXml: () => {
          return bridgeRef.current?.exportXml() ?? Promise.resolve("");
        },
        save: () => {
          bridgeRef.current?.save();
        },
        waitReady: async () => {
          await bridgeRef.current?.waitReady();
        },
        get bridge() {
          return bridgeRef.current;
        },
      }) as DrawioEditorHandle,
    [],
  );

  // iframe 加载错误处理
  const handleIframeError = () => {
    setError(`无法连接到 draw.io 服务 (${baseUrl})。请确认 Docker 服务已启动。`);
    setLoading(false);
  };

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden">
      {/* 加载状态 */}
      {loading && !error && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background">
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">正在加载 draw.io 编辑器...</p>
        </div>
      )}

      {/* 错误状态 */}
      {error && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-background p-8">
          <div className="text-destructive text-lg font-medium">连接失败</div>
          <p className="text-muted-foreground max-w-md text-center text-sm">{error}</p>
          <div className="text-muted-foreground mt-2 space-y-1 rounded-md border p-4 text-left text-xs">
            <p className="font-medium">确认步骤：</p>
            <p>1. 确保已启动 Docker 容器：<code className="rounded bg-muted px-1">docker-compose up -d drawio</code></p>
            <p>2. 确认服务地址：<code className="rounded bg-muted px-1">{baseUrl}</code></p>
            <p>3. 检查防火墙是否放行对应端口</p>
          </div>
        </div>
      )}

      {/* draw.io iframe */}
      <iframe
        ref={iframeRef}
        src={embedUrl()}
        className="h-full w-full border-0"
        title="Draw.io Editor"
        allow="clipboard-read; clipboard-write"
        onError={handleIframeError}
      />
    </div>
  );
}
