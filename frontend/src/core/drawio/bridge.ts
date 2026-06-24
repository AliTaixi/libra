/**
 * draw.io iframe postMessage 通信桥
 *
 * 负责与嵌入的 draw.io iframe 进行双向通信：
 * - 读取当前图表的 XML
 * - 注入新图表 XML
 * - 导出为 PNG/SVG
 * - 监听编辑状态变化
 */

import type { DrawioMessageEvent, DrawioRequest } from "./types";

type MessageHandler = (event: DrawioMessageEvent) => void;

/**
 * Draw.io Iframe 通信桥
 *
 * 负责与嵌入的 draw.io iframe 进行双向通信：
 * - 读取当前图表的 XML
 * - 注入新图表 XML
 * - 导出
 * - 监听编辑状态变化
 *
 * 用法:
 * ```tsx
 * const iframeRef = useRef<HTMLIFrameElement>(null);
 * const bridge = new DrawioBridge(() => iframeRef.current);
 *
 * bridge.waitReady().then(() => {
 *   bridge.loadXml('<mxGraphModel>...</mxGraphModel>');
 * });
 * ```
 */
export class DrawioBridge {
  private getIframe: () => HTMLIFrameElement | null;
  private handlers = new Map<string, MessageHandler[]>();
  private ready = false;
  private pendingRequests: Array<() => void> = [];
  private boundHandleMessage: (e: MessageEvent) => void;

  constructor(getIframe: () => HTMLIFrameElement | null) {
    this.getIframe = getIframe;
    this.boundHandleMessage = this.handleMessage.bind(this);
    window.addEventListener("message", this.boundHandleMessage);
  }

  /** 是否已就绪 */
  get isReady(): boolean {
    return this.ready;
  }

  /** 等待就绪 */
  waitReady(): Promise<void> {
    if (this.ready) return Promise.resolve();
    return new Promise((resolve) => {
      this.pendingRequests.push(resolve);
    });
  }

  /** 加载新的图表 XML */
  loadXml(xml: string): void {
    this.postMessage({ action: "load", xml });
  }

  /** 导出当前图表为 XML */
  exportXml(): Promise<string> {
    return new Promise((resolve) => {
      const handler = (msg: DrawioMessageEvent) => {
        if (msg.event === "export" && msg.xml) {
          resolve(msg.xml);
          this.off("export", handler);
        }
      };
      this.on("export", handler);
      this.postMessage({ action: "export", format: "xml" });
    });
  }

  /** 保存 */
  save(): void {
    this.postMessage({ action: "save" });
  }

  /** 监听 draw.io 事件 */
  on(event: string, handler: MessageHandler): void {
    const handlers = this.handlers.get(event) ?? [];
    handlers.push(handler);
    this.handlers.set(event, handlers);
  }

  /** 移除事件监听 */
  off(event: string, handler: MessageHandler): void {
    const handlers = this.handlers.get(event);
    if (!handlers) return;
    this.handlers.set(
      event,
      handlers.filter((h) => h !== handler),
    );
  }

  /** 清理 */
  destroy(): void {
    this.handlers.clear();
    window.removeEventListener("message", this.boundHandleMessage);
  }

  private handleMessage(e: MessageEvent): void {
    const iframe = this.getIframe();
    if (!iframe || e.source !== iframe.contentWindow) return;

    try {
      const msg = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
      if (!msg.event) return;

      if (msg.event === "init") {
        this.ready = true;
        this.pendingRequests.forEach((resolve) => resolve());
        this.pendingRequests = [];
      }

      const handlers = this.handlers.get(msg.event);
      if (handlers) {
        handlers.forEach((handler) => handler(msg as DrawioMessageEvent));
      }
    } catch {
      // 非 JSON 消息忽略
    }
  }

  private postMessage(request: DrawioRequest): void {
    const iframe = this.getIframe();
    if (!iframe?.contentWindow) return;
    iframe.contentWindow.postMessage(JSON.stringify(request), "*");
  }
}

