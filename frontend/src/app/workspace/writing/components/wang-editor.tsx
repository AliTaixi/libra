"use client";

import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from "react";
import { Editor } from "@wangeditor/editor-for-react";
import { IDomEditor, IEditorConfig, createToolbar } from "@wangeditor/editor";
import "@wangeditor/editor/dist/css/style.css";
import { getBackendBaseURL } from "@/core/config";
import { fetch as authFetch } from "@/core/api/fetcher";
import { toast } from "sonner";

export interface WangEditorHandle {
  replaceSelection: (html: string) => void;
  /** 在选中文字之后插入 HTML，不删除选中内容 */
  insertAfterSelection: (html: string) => void;
  getLastSelection: () => { text: string; from: number; to: number };
  focus: () => void;
  getEditor: () => IDomEditor | null;
}

interface WangEditorProps {
  content: string;
  /** onChange 增加 chapterKey 参数，用于上层校验来源章节，防止卸载时发生章节覆盖 */
  onChange: (html: string, chapterKey?: string | number) => void;
  placeholder?: string;
  editable?: boolean;
  chapterKey?: string | number;
}

const TOOLBAR_CONFIG = {
  excludeKeys: ["insertVideo"],
};

// ── 视觉高亮 overlay 工具 ──────────────────────────────────────────
// 当左侧面板被点击时，用 DOM 覆盖层模拟选中高亮，不依赖编辑器焦点
function removeSelectionOverlay() {
  const container = document.getElementById("wang-selection-overlay");
  if (container) container.remove();
}

function showSelectionOverlay(range: Range) {
  removeSelectionOverlay(); // 清理旧的

  const rects = range.getClientRects();
  if (!rects || rects.length === 0) return;

  const wrapper = document.createElement("div");
  wrapper.id = "wang-selection-overlay";
  wrapper.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:9999;";

  for (const rect of rects) {
    if (rect.width === 0 && rect.height === 0) continue;
    const bar = document.createElement("div");
    bar.style.cssText = [
      `position:fixed;left:${rect.left}px;top:${rect.top}px;`,
      `width:${rect.width}px;height:${rect.height}px;`,
      "background:rgba(0,120,215,0.15);pointer-events:none;",
    ].join("");
    wrapper.appendChild(bar);
  }

  document.body.appendChild(wrapper);
}

export const WangEditor = forwardRef<WangEditorHandle, WangEditorProps>(function WangEditor({
  content,
  onChange,
  placeholder = "开始写作...",
  editable = true,
  chapterKey,
}, ref) {
  const [editor, setEditor] = useState<IDomEditor | null>(null);
  const editorInstanceRef = useRef<IDomEditor | null>(null);
  const lastSelectionRef = useRef({ text: "", from: 0, to: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  // 初始为 true：抑制编辑器挂载时产生的默认空内容 onChange（<p><br></p>）
  const skipNextOnChange = useRef(true);

  // 用 ref 跟踪 chapterKey，确保 onChange 回调中能拿到最新的值
  const chapterKeyRef = useRef(chapterKey);
  chapterKeyRef.current = chapterKey;

  // 确保内容有 HTML 包裹，防止 Slate 纯文本崩溃
  // 使用普通函数而非 useCallback，避免导入问题
  const normalizeHtml = (html: string): string => {
    if (!html) return html;
    if (/<[a-z]/i.test(html)) return html; // 已有 HTML 标签（<xxx>）
    return `<p>${html}</p>`; // 纯文本 → 用 <p> 包裹
  };

  const mountKey = chapterKey ?? 0;

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editorConfigRef = useRef<IEditorConfig>({
    placeholder,
    readOnly: !editable,
    onChange: (ed: IDomEditor) => {
      if (skipNextOnChange.current) {
        skipNextOnChange.current = false;
        return;
      }
      const html = ed.getHtml();
      // 保护：忽略编辑器默认空内容，防止覆盖已有章节内容
      if (html === "<p><br></p>" || html === "<p></p>" || !html.trim()) {
        return;
      }
      // 传递 chapterKey 供上层校验，防止章节切换时的卸载回调覆盖其他章节内容
      onChangeRef.current?.(html, chapterKeyRef.current);
    },
    onBlur: (ed: IDomEditor) => {
      // 检测是否为左侧面板点击导致的 blur
      if ((window as any).__writingPreserveSelection) {
        (window as any).__writingPreserveSelection = false;
        const savedRange = (window as any).__writingSavedRange as Range | null;
        // 不调用 ed.focus() —— 避免窃取左侧面板输入框的焦点
        // 改用 DOM overlay 视觉高亮来示意选中范围
        if (savedRange) {
          try {
            showSelectionOverlay(savedRange);
          } catch { /* 高亮失败不影响功能 */ }
        }
        (window as any).__writingSavedRange = null;
      }
    },
    customPaste: () => true,
    // 拖拽/粘贴图片时触发
    customUploadImg: async (resultFiles: File[], _insertImgFn: (url: string) => void) => {
      const base = getBackendBaseURL();
      for (const file of resultFiles) {
        try {
          const formData = new FormData();
          formData.append("file", file);
          const resp = await authFetch(`${base}/api/writing/upload`, { method: "POST", body: formData });
          if (!resp.ok) {
            const errBody = await resp.json().catch(() => ({ detail: `HTTP ${resp.status}` }));
            throw new Error(errBody.detail ?? `上传失败: ${resp.status}`);
          }
          const data = await resp.json();
          const fileName = (data.path || "").split(/[\\/]/).pop() || "";
          if (fileName) {
            const ed = editorInstanceRef.current;
            if (ed) {
              ed.dangerouslyInsertHtml(`<img src="${base}/api/writing/files/${fileName}" crossorigin="use-credentials" alt="${fileName}" />`);
            }
            toast.success(`图片已上传`);
          }
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : "图片上传失败";
          console.error("图片上传失败:", msg);
          toast.error(msg);
        }
      }
    },
    // 工具栏"图片→上传图片"按钮使用 MENU_CONF
    MENU_CONF: {
      uploadImage: {
        async customUpload(file: File, _insertFn: (url: string, alt: string, href: string) => void) {
          const base = getBackendBaseURL();
          try {
            const formData = new FormData();
            formData.append("file", file);
            const resp = await authFetch(`${base}/api/writing/upload`, { method: "POST", body: formData });
            if (!resp.ok) {
              const errBody = await resp.json().catch(() => ({ detail: `HTTP ${resp.status}` }));
              throw new Error(errBody.detail ?? `上传失败: ${resp.status}`);
            }
            const data = await resp.json();
            const fileName = (data.path || "").split(/[\\/]/).pop() || "";
            if (fileName) {
              const ed = editorInstanceRef.current;
              if (ed) {
                ed.dangerouslyInsertHtml(`<img src="${base}/api/writing/files/${fileName}" crossorigin="use-credentials" alt="${fileName}" />`);
              }
              toast.success(`图片已上传`);
            }
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "图片上传失败";
            console.error("图片上传失败:", msg);
            toast.error(msg);
          }
        },
      },
    },
  });

  // 1) 编辑器初始化时，用当前 content 填充
  useEffect(() => {
    if (!editor) return;
    if (!content) return; // 空内容保护：避免 Slate 空节点崩溃
    skipNextOnChange.current = true;
    editor.setHtml(normalizeHtml(content));
  }, [editor]);

  // 2) content 变化时（AI 回写/SSE 更新/自动保存回写），同步编辑器，跳过 onChange
  useEffect(() => {
    if (!editor) return;
    if (!content) return; // 空内容保护：避免 Slate 空节点崩溃
    skipNextOnChange.current = true;
    editor.setHtml(normalizeHtml(content));
    // 给已有 <img> 补上 crossorigin，确保加载时携带 cookie
    setTimeout(() => {
      try {
        const editorEl = editorInstanceRef.current?.getEditableContainer?.();
        if (editorEl) {
          editorEl.querySelectorAll('img').forEach(img => {
            if (!img.getAttribute('crossorigin')) {
              img.setAttribute('crossorigin', 'use-credentials');
            }
          });
        }
      } catch { /* 静默 */ }
    }, 0);
  }, [content]);

  // Toolbar
  useEffect(() => {
    if (!editor || !toolbarRef.current) return;
    const toolbar = createToolbar({ editor, selector: toolbarRef.current, config: TOOLBAR_CONFIG, mode: "default" });
    return () => { try { toolbar.destroy(); } catch {} };
  }, [editor]);

  // 编辑器/页面滚动时清除视觉高亮（位置会错位）
  useEffect(() => {
    const removeOnScroll = () => removeSelectionOverlay();
    // 页面滚动
    window.addEventListener("scroll", removeOnScroll, { passive: true });
    // 编辑器容器 capture 模式：scroll 事件不冒泡但会走捕获阶段，
    // 可捕获 .w-e-text-container 以及内部任何可滚动子元素的 scroll 事件
    const container = containerRef.current;
    if (container) {
      container.addEventListener("scroll", removeOnScroll, { capture: true, passive: true });
    }
    return () => {
      window.removeEventListener("scroll", removeOnScroll);
      if (container) {
        container.removeEventListener("scroll", removeOnScroll, { capture: true });
      }
    };
  }, [editor]);

  // 点击编辑器区域时清除视觉高亮
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = () => removeSelectionOverlay();
    el.addEventListener("mousedown", handler);
    return () => el.removeEventListener("mousedown", handler);
  }, [editor]);

  // 选中跟踪
  useEffect(() => {
    const fn = () => {
      if (!containerRef.current) return;
      const sel = window.getSelection();
      if (sel && sel.toString().trim() && containerRef.current.contains(sel.anchorNode)) {
        lastSelectionRef.current = { text: sel.toString().trim(), from: 0, to: 0 };
      }
    };
    document.addEventListener("selectionchange", fn);
    return () => document.removeEventListener("selectionchange", fn);
  }, []);

  // 直接监听 DOM，移除 Slate 错误对应的 Next.js 浮层节点
  useEffect(() => {
    const obs = new MutationObserver(() => {
      const el = document.querySelector("nextjs-portal") ||
                 document.querySelector("[data-nextjs-error-overlay]") ||
                 document.querySelector("#__nextjs-error-overlay");
      if (el) {
        const text = el.textContent || "";
        if (text.includes("Cannot resolve a DOM node from Slate node")) {
          el.remove();
        }
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, []);

  // 组件卸载时确保清除视觉高亮
  useEffect(() => {
    return () => removeSelectionOverlay();
  }, []);

  // 字体样式
  useEffect(() => {
    if (document.getElementById("wang-editor-font-style")) return;
    const s = document.createElement("style");
    s.id = "wang-editor-font-style";
    s.textContent = [
      /* 全局字体：英文/数字→Times New Roman，中文自动回退→SimSun */
      `.w-e-text-container{font-family:'Times New Roman',SimSun,serif!important;height:100%!important;min-height:300px!important;overflow-y:auto!important}`,
      /* 正文段落：首行缩进2字符 + 1.5倍行距 */
      `.w-e-text-container p{text-indent:2em!important;margin:0 0 0.25em!important;line-height:1.6!important}`,
      /* 加粗显式生效 */
      `.w-e-text-container strong,.w-e-text-container b{font-weight:700!important}`,
      /* 超链接 → Calibri */
      `.w-e-text-container a{font-family:Calibri,'Times New Roman',SimSun,serif!important}`,
      /* 标题：取消首行缩进，保留加粗 */
      `.w-e-text-container h1,.w-e-text-container h2,.w-e-text-container h3,.w-e-text-container h4{font-weight:700!important;text-indent:0!important;margin:0.5em 0 0.25em!important}`,
      `.w-e-text-container h1{font-size:1.5em!important}.w-e-text-container h2{font-size:1.3em!important}.w-e-text-container h3{font-size:1.15em!important}`,
      /* 列表项：取消首行缩进 */
      `.w-e-text-container li{text-indent:0!important}`,
      `.wang-editor-wrapper .flex-1{min-height:0!important}`,
    ].join("");
    document.head.appendChild(s);
  }, []);

  /** 确保编辑器有有效选中，防止 Slate 因选中为空导致 undo 崩溃 */
  const ensureValidSelection = useCallback(() => {
    if (!editor) return false;
    if (editor.selection) return true; // 已有有效选中
    try {
      editor.restoreSelection();
      if (editor.selection) return true;
    } catch { /* ignore */ }
    try {
      // 兜底：将光标移到文档末尾
      const lastChild = editor.children?.at(-1);
      if (lastChild) {
        const textNode = lastChild.children?.at(-1);
        if (textNode && typeof textNode.text === 'string') {
          editor.select({
            anchor: { path: [editor.children.length - 1, (lastChild.children?.length || 1) - 1], offset: textNode.text.length },
            focus: { path: [editor.children.length - 1, (lastChild.children?.length || 1) - 1], offset: textNode.text.length },
          });
          return true;
        }
      }
    } catch { /* ignore */ }
    return false;
  }, [editor]);

  useImperativeHandle(ref, () => ({
    replaceSelection: (html: string) => {
      if (!editor) return;
      removeSelectionOverlay();
      (window as any).__writingLeftPanelActive = false;
      editor.focus();
      // 确保有有效选中再插入，避免 Slate 选中状态不一致
      ensureValidSelection();
      editor.dangerouslyInsertHtml(html);
    },
    insertAfterSelection: (html: string) => {
      if (!editor) return;
      removeSelectionOverlay();
      (window as any).__writingLeftPanelActive = false;
      editor.focus();
      ensureValidSelection();
      // 找到选区的真正终点（Slate 的 anchor/focus 随选中方向变化，
      // 正向选中 focus=终点，反向选中 focus=起点，必须比较 path+offset）
      if (editor.selection) {
        const { anchor, focus } = editor.selection;
        // 逐级比较 path 数组，谁更靠后谁就是终点
        let endPoint = focus;
        for (let i = 0; i < Math.min(anchor.path.length, focus.path.length); i++) {
          if (anchor.path[i] === focus.path[i]) continue;
          endPoint = anchor.path[i] > focus.path[i] ? anchor : focus;
          break;
        }
        // path 前缀相同时，更长的 path 靠后
        if (endPoint === focus && anchor.path.length !== focus.path.length) {
          endPoint = anchor.path.length > focus.path.length ? anchor : focus;
        }
        // path 完全相同时比较 offset
        if (endPoint === focus &&
            anchor.path.length === focus.path.length &&
            anchor.path.every((v: number, i: number) => v === focus.path[i])) {
          endPoint = anchor.offset > focus.offset ? anchor : focus;
        }
        editor.select({ anchor: endPoint, focus: endPoint });
      }
      editor.dangerouslyInsertHtml(html);
    },
    getLastSelection: () => lastSelectionRef.current,
    focus: () => {
      removeSelectionOverlay();
      (window as any).__writingLeftPanelActive = false;
      editor?.focus();
    },
    getEditor: () => editor,
  }), [editor]);

  return (
    <div ref={containerRef} className="wang-editor-wrapper h-full w-full flex flex-col">
      <div key={mountKey} className="flex flex-col flex-1">
        <div ref={toolbarRef} className="border-b shrink-0" />
        <Editor
          defaultConfig={editorConfigRef.current}
          onCreated={(ed) => { editorInstanceRef.current = ed; setEditor(ed); }}
          className="flex-1"
          style={{ flex: 1 }}
        />
      </div>
    </div>
  );
});
