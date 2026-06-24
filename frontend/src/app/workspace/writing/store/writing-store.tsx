"use client";

import React, { createContext, useCallback, useContext, useReducer, useEffect, useRef, useState, type ReactNode } from "react";

import { updateDraft } from "@/core/writing/api";

// ── 阶段定义 ───────────────────────────────────────────────────────────────

export type WritingMode = "from-scratch" | "upload-template";
export type WritingStage = "start" | "writing" | "complete";

/** 大纲标题节点 */
export interface OutlineHeading {
  id: string;
  title: string;
  subCount: number; // 用户选择的子标题数量，0 = 无子标题
  subheadings?: OutlineHeading[];
}

export interface StructureItem {
  level: number;
  title: string;
  children?: StructureItem[];
}

export interface Chapter {
  id: string;
  title: string;
  content: string;
  structure?: StructureItem[];
  bodyText?: string;
  modified?: boolean;  // 用户手动修改后标记为已修改
}

export interface UploadedFile {
  name: string;
  path: string;
  type: "template" | "description" | "format";
}

export interface ChartConfig {
  type: string; // bar, line, pie, scatter, box, violin, heatmap
  tool: string; // "1" | "2"
  data: string;
  title: string;
}

export interface GenerationState {
  status: "idle" | "generating" | "completed" | "interrupted";
  pending_chapters: number[];
  failed_chapters: number[];
  generated_chapters: number[];
  last_error?: string;
}

// ── 状态 ───────────────────────────────────────────────────────────────────

export interface WritingState {
  draftId: number | null;
  stage: WritingStage;
  mode: WritingMode | null;
  loading: boolean;
  saving: boolean;

  // Phase 1: Start
  projectName: string;
  docType: string;
  description: string; // 补充说明
  files: UploadedFile[];
  modelName: string; // 使用的模型名称
  kbCollectionId: string; // 关联的知识库集合 ID

  // Phase 2: Writing
  chapters: Chapter[];
  currentChapterIndex: number;
  wordCountMin: number;
  wordCountMax: number;
  demandInput: string;
  generatingIndex: number;  // -1 = 未生成/已完成, >=0 = 正在生成的章节索引

  // 后端生成进度（轮询用）
  generationState: GenerationState;

  // Selection state for chart/frame/table
  selectedText: string;
  selectedPosition: { from: number; to: number } | null;

  // Phase 3: Complete
  finished: boolean;
}

type Action =
  | { type: "SET_DRAFT_ID"; payload: number | null }
  | { type: "SET_LOADING"; payload: boolean }
  | { type: "SET_SAVING"; payload: boolean }
  | { type: "LOAD_DRAFT"; payload: Partial<WritingState> }
  | { type: "SET_STAGE"; payload: WritingStage }
  | { type: "SET_MODE"; payload: WritingMode | null }
  | { type: "SET_PROJECT_NAME"; payload: string }
  | { type: "SET_DOC_TYPE"; payload: string }
  | { type: "SET_DESCRIPTION"; payload: string }
  | { type: "SET_MODEL_NAME"; payload: string }
  | { type: "SET_KB_COLLECTION"; payload: string }
  | { type: "ADD_FILE"; payload: UploadedFile }
  | { type: "REMOVE_FILE"; payload: string }
  | { type: "SET_CHAPTERS"; payload: Chapter[] }
  | { type: "SET_CURRENT_CHAPTER"; payload: number }
  | { type: "UPDATE_CHAPTER_CONTENT"; payload: { index: number; content: string } }
  | { type: "NEXT_CHAPTER" }
  | { type: "PREV_CHAPTER" }
  | { type: "SET_WORD_COUNT"; payload: { min: number; max: number } }
  | { type: "SET_DEMAND_INPUT"; payload: string }
  | { type: "SET_SELECTION"; payload: { text: string; from: number; to: number } | null }
  | { type: "CLEAR_SELECTION" }
  | { type: "SET_FINISHED"; payload: boolean }
  | { type: "SET_GENERATING_INDEX"; payload: number }
  | { type: "SET_GENERATION_STATE"; payload: GenerationState }
  | { type: "RESET" };

const initialState: WritingState = {
  draftId: null,
  stage: "start",
  mode: null,
  loading: false,
  saving: false,
  projectName: "",
  docType: "report",
  description: "",
  files: [],
  modelName: "",
  kbCollectionId: "",
  chapters: [],
  currentChapterIndex: 0,
  wordCountMin: 0,
  wordCountMax: 0,
  demandInput: "",
  generatingIndex: -1,
  generationState: { status: "idle", pending_chapters: [], failed_chapters: [], generated_chapters: [] },
  selectedText: "",
  selectedPosition: null,
  finished: false,
};

function writingReducer(state: WritingState, action: Action): WritingState {
  switch (action.type) {
    case "SET_DRAFT_ID":
      return { ...state, draftId: action.payload };
    case "SET_LOADING":
      return { ...state, loading: action.payload };
    case "SET_SAVING":
      return { ...state, saving: action.payload };
    case "LOAD_DRAFT":
      return { ...state, ...action.payload, loading: false, modelName: action.payload.modelName ?? state.modelName };
    case "SET_STAGE":
      return { ...state, stage: action.payload };
    case "SET_MODE":
      return { ...state, mode: action.payload };
    case "SET_PROJECT_NAME":
      return { ...state, projectName: action.payload };
    case "SET_DOC_TYPE":
      return { ...state, docType: action.payload };
    case "SET_DESCRIPTION":
      return { ...state, description: action.payload };
    case "SET_MODEL_NAME":
      return { ...state, modelName: action.payload };
    case "SET_KB_COLLECTION":
      return { ...state, kbCollectionId: action.payload };
    case "ADD_FILE":
      return { ...state, files: [...state.files.filter(f => f.type !== action.payload.type), action.payload] };
    case "REMOVE_FILE":
      return { ...state, files: state.files.filter(f => f.path !== action.payload) };
    case "SET_CHAPTERS":
      // 保留当前章节索引，SSE 更新 chapters 时不跳回第一章
      return { ...state, chapters: action.payload };
    case "SET_CURRENT_CHAPTER":
      return { ...state, currentChapterIndex: action.payload };
    case "UPDATE_CHAPTER_CONTENT":
      return {
        ...state,
        chapters: state.chapters.map((ch, i) =>
          i === action.payload.index ? { ...ch, content: action.payload.content } : ch
        ),
      };
    case "NEXT_CHAPTER":
      if (state.currentChapterIndex < state.chapters.length - 1) {
        return { ...state, currentChapterIndex: state.currentChapterIndex + 1 };
      }
      return state;
    case "PREV_CHAPTER":
      if (state.currentChapterIndex > 0) {
        return { ...state, currentChapterIndex: state.currentChapterIndex - 1 };
      }
      return state;
    case "SET_WORD_COUNT":
      return { ...state, wordCountMin: action.payload.min, wordCountMax: action.payload.max };
    case "SET_DEMAND_INPUT":
      return { ...state, demandInput: action.payload };
    case "SET_SELECTION":
      return action.payload
        ? { ...state, selectedText: action.payload.text, selectedPosition: { from: action.payload.from, to: action.payload.to } }
        : { ...state, selectedText: "", selectedPosition: null };
    case "CLEAR_SELECTION":
      return { ...state, selectedText: "", selectedPosition: null };
    case "SET_FINISHED":
      return { ...state, finished: action.payload };
    case "SET_GENERATING_INDEX":
      return { ...state, generatingIndex: action.payload };
    case "SET_GENERATION_STATE":
      return { ...state, generationState: action.payload };
    case "RESET":
      return initialState;
    default:
      return state;
  }
}

// ── 序列化为 API 格式 ─────────────────────────────────────────────────────

export function stateToDraftPayload(state: WritingState) {
  return {
    project_name: state.projectName || undefined,
    doc_type: state.docType || undefined,
    description: state.description || undefined,
    mode: state.mode,
    stage: state.stage,
    files: state.files.length > 0 ? state.files : undefined,
    chapters: state.chapters.length > 0 ? state.chapters : undefined,
    word_count_min: state.wordCountMin || undefined,
    word_count_max: state.wordCountMax || undefined,
    // demandInput 和 generationState 是临时 UI 状态，由后端管理，前端不覆盖
    finished: state.finished || undefined,
    model_name: state.modelName || undefined,
  };
}

// ── Context ────────────────────────────────────────────────────────────────

const WritingStateContext = createContext<WritingState>(initialState);
const WritingDispatchContext = createContext<React.Dispatch<Action>>(() => {});

export function WritingProvider({
  children,
  draftId: initialDraftId,
  initialModelName,
}: {
  children: ReactNode;
  draftId?: number | null;
  initialModelName?: string;
}) {
  const [state, dispatch] = useReducer(writingReducer, {
    ...initialState,
    modelName: initialModelName || "",
  });
  const [hydrated, setHydrated] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const isInitRef = useRef(true);

  // 加载草稿
  useEffect(() => {
    if (initialDraftId && initialDraftId > 0 && !hydrated) {
      dispatch({ type: "SET_LOADING", payload: true });
      dispatch({ type: "SET_DRAFT_ID", payload: initialDraftId });
      import("@/core/writing/api").then(({ getDraft }) => {
        getDraft(initialDraftId).then((res) => {
          if (res.success && res.draft) {
            const d = res.draft;
      dispatch({
        type: "LOAD_DRAFT",
        payload: {
          draftId: initialDraftId,
          stage: (d.stage as WritingStage) || "start",
          mode: (d.mode as WritingMode) || null,
          projectName: (d.project_name as string) || "",
          docType: (d.doc_type as string) || "report",
          description: (d.description as string) || "",
          files: (d.files as UploadedFile[]) || [],
          modelName: (d.model_name as string) || "",
          chapters: (d.chapters as Chapter[]) || [],
          wordCountMin: (d.word_count_min as number) || 0,
          wordCountMax: (d.word_count_max as number) || 0,
          demandInput: "",  // 修改需求是临时输入，刷新后清空
          finished: (d.finished as boolean) || false,
          generationState: (d.generation_state as GenerationState) || { status: "idle", pending_chapters: [], failed_chapters: [], generated_chapters: [] },
        },
      });
          }
          setHydrated(true);
        }).catch(() => {
          // 草稿加载失败→重置 draftId，避免后续 auto-save 报 404
          dispatch({ type: "SET_DRAFT_ID", payload: null });
          dispatch({ type: "SET_LOADING", payload: false });
          setHydrated(true);
        });
      });
    } else if (!initialDraftId) {
      setHydrated(true);
    }
  }, [initialDraftId, hydrated]);

  // 不再自动保存：由用户手动触发（Ctrl+S / 保存按钮 / 退出页面时保存）
  useEffect(() => {
    if (isInitRef.current) {
      isInitRef.current = false;
    }
  }, []);

  // beforeunload + Ctrl+S 保存
  useEffect(() => {
    const saveCurrent = async () => {
      const s = stateRef.current;
      if (!s.draftId) return;
      // 生成进行中不保存，防止覆盖后端正在写入的章节内容（解决 SSE 期间的 lost-update 竞态）
      if (s.generationState.status === "generating") {
        console.log("[写作] 跳过保存：AI 生成进行中，避免覆盖后端写入");
        return;
      }
      dispatch({ type: "SET_SAVING", payload: true });
      try {
        const payload = stateToDraftPayload(s);
        await updateDraft(s.draftId, payload);
        console.log("[写作] 手动保存成功");
      } catch {
        // 静默失败
      } finally {
        dispatch({ type: "SET_SAVING", payload: false });
      }
    };

    const handleBeforeUnload = () => {
      saveCurrent();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        saveCurrent();
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <WritingStateContext.Provider value={state}>
      <WritingDispatchContext.Provider value={dispatch}>
        {children}
      </WritingDispatchContext.Provider>
    </WritingStateContext.Provider>
  );
}

export function useWritingState() {
  return useContext(WritingStateContext);
}

export function useWritingDispatch() {
  return useContext(WritingDispatchContext);
}

/** 同步保存草稿到后端（手动调用，如阶段切换时） */
export function useSaveDraft() {
  const state = useWritingState();
  return useCallback(async () => {
    if (!state.draftId) return;
    const payload = stateToDraftPayload(state);
    await updateDraft(state.draftId, payload);
  }, [state]);
}
