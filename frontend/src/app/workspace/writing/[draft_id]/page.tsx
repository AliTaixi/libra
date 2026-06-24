"use client";

import { useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import {
  WorkspaceBody,
  WorkspaceContainer,
} from "@/components/workspace/workspace-container";
import { getBackendBaseURL } from "@/core/config";
import { WritingProvider, useWritingState, useWritingDispatch } from "../store/writing-store";
import { StageOne } from "../components/stage-one";
import { StageTwo } from "../components/stage-two";
import { StageThree } from "../components/stage-three";
import { toast } from "sonner";

function WritingContent() {
  const state = useWritingState();
  const dispatch = useWritingDispatch();
  const eventSourceRef = useRef<EventSource | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    document.title = "全文写作 - Libra";
  }, []);

  // 从 URL 读取模型名（客户端渲染后才可读到 searchParams）
  useEffect(() => {
    const model = new URLSearchParams(window.location.search).get("model");
    if (model) {
      dispatch({ type: "SET_MODEL_NAME", payload: model });
    }
  }, [dispatch]);

  // ── SSE 实时续生：草稿加载后自动连接 ────────────────────────────
  useEffect(() => {
    if (!state.draftId || state.loading) return;
    if (eventSourceRef.current) return; // 避免重复连接

    const gs = state.generationState;
    console.log("[写作SSE] 状态:", gs.status, "待生成:", gs.pending_chapters?.length);
    // 只在需要续生时连接（interrupted 或已有待生成章节）
    if (gs.status !== "interrupted" && gs.status !== "generating") {
      console.log("[写作SSE] 状态不匹配，不连接");
      return;
    }
    if (!gs.pending_chapters?.length) {
      console.log("[写作SSE] 无待生成章节");
      return;
    }

    const url = `${getBackendBaseURL()}/api/writing/drafts/${state.draftId}/stream`;
    console.log("[写作SSE] 连接:", url);
    const es = new EventSource(url);
    eventSourceRef.current = es;
    // SSE 已连接 → 标记为生成中（锁定未生成章节，显示 loading）
    dispatch({ type: "SET_GENERATING_INDEX", payload: 0 });

    es.addEventListener("chapter", (event) => {
      try {
        const data = JSON.parse(event.data);
        const doneIndex = data.index as number;
        const newContent = data.content as string;
        // 增量更新：只更新已生成的章节，不替换全部（防止覆盖用户编辑/其他章节内容）
        if (typeof doneIndex === "number" && typeof newContent === "string") {
          dispatch({ type: "UPDATE_CHAPTER_CONTENT", payload: { index: doneIndex, content: newContent } });
        }
        // 更新生成状态：移除 pending，加入 generated
        if (typeof doneIndex === "number") {
          const cur = stateRef.current.generationState;
          const hasError = !!(data.error as string);
          dispatch({
            type: "SET_GENERATION_STATE",
            payload: {
              ...cur,
              status: "generating",
              pending_chapters: (cur.pending_chapters || []).filter((i: number) => i !== doneIndex),
              generated_chapters: [...(cur.generated_chapters || []), doneIndex],
              failed_chapters: hasError
                ? [...(cur.failed_chapters || []), doneIndex]
                : (cur.failed_chapters || []),
              last_error: (data.error as string) || "",
            },
          });
          if (hasError) {
            console.warn(`[写作SSE] 第 ${doneIndex + 1} 章生成异常:`, data.error);
          }
        }
      } catch (e) {
        console.warn("[写作SSE] 解析 chapter 事件失败:", e);
      }
    });

    es.addEventListener("completed", () => {
      const lastState = stateRef.current.generationState;
      const failed = lastState.failed_chapters || [];
      dispatch({
        type: "SET_GENERATION_STATE",
        payload: {
          status: "completed",
          pending_chapters: [],
          failed_chapters: failed,
          generated_chapters: lastState.generated_chapters || [],
          last_error: failed.length > 0 ? `${failed.length} 个章节生成失败` : "",
        },
      });
      dispatch({ type: "SET_GENERATING_INDEX", payload: -1 });
      es.close();
      eventSourceRef.current = null;
      if (failed.length > 0) {
        toast.warning(`生成完成，但 ${failed.length} 个章节内容为空，请手动重新生成`);
      } else {
        toast.success("全部章节内容已生成");
      }
    });

    es.addEventListener("error", (event) => {
      console.error("[写作SSE] 连接错误:", event);
      // EventSource 遇到错误会自动重连，不需要额外处理
      // 如果彻底关闭，标记为 interrupted 以便下次刷新重试
      if (es.readyState === EventSource.CLOSED) {
        dispatch({ type: "SET_GENERATING_INDEX", payload: -1 });
        eventSourceRef.current = null;
        toast.error("生成连接已断开，可刷新页面重试");
      }
    });

    es.addEventListener("interrupted", () => {
      const lastState = stateRef.current.generationState;
      dispatch({
        type: "SET_GENERATION_STATE",
        payload: {
          status: "interrupted",
          pending_chapters: lastState.pending_chapters || [],
          failed_chapters: lastState.failed_chapters || [],
          generated_chapters: lastState.generated_chapters || [],
          last_error: "生成被中断",
        },
      });
      dispatch({ type: "SET_GENERATING_INDEX", payload: -1 });
      es.close();
      eventSourceRef.current = null;
      toast.warning("生成被中断，可在修改后刷新页面继续");
    });

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [state.draftId, state.loading, state.generationState.status]);

  if (state.loading) {
    return (
      <WorkspaceContainer>
        <WorkspaceBody>
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            加载草稿中...
          </div>
        </WorkspaceBody>
      </WorkspaceContainer>
    );
  }

  return (
    <WorkspaceContainer>
      <WorkspaceBody>
        <div className="flex h-full w-full">
          {state.stage === "start" && <StageOne />}
          {state.stage === "writing" && <StageTwo />}
          {state.stage === "complete" && <StageThree />}
        </div>
      </WorkspaceBody>
    </WorkspaceContainer>
  );
}

export default function WritingDraftPage() {
  const params = useParams<{ draft_id: string }>();
  const draftIdParam = params?.draft_id;
  const draftId = draftIdParam && draftIdParam !== "new" ? Number(draftIdParam) : null;

  return (
    <WritingProvider draftId={draftId}>
      <WritingContent />
    </WritingProvider>
  );
}
