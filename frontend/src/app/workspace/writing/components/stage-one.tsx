"use client";

import { useState, useRef, useCallback, useEffect, type ChangeEvent } from "react";
import { FileUp, FileText, ArrowRight, Upload, Check, X, Loader2, Plus, Trash2, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { useI18n } from "@/core/i18n/hooks";
import { useWritingState, useWritingDispatch, type OutlineHeading } from "../store/writing-store";
import { createDraft, updateDraft as updateDraftApi, generateOutline, uploadWritingFile } from "@/core/writing/api";
import { listCollections } from "@/core/knowledge-base/client";

const DOC_TYPES = [
  { value: "report", label: "报告" },
  { value: "proposal", label: "方案" },
  { value: "thesis", label: "论文" },
  { value: "manual", label: "说明书" },
  { value: "spec", label: "技术规范" },
];

/** 扁平 OutlineHeading → Chapter 数组，带层级编号（1. / 1.1 / 1.1.1） */
function outlineToChapters(headings: OutlineHeading[]) {
  return headings.map((h, i) => {
    const l1Num = `${i + 1}`;
    const numberedTitle = `${l1Num}. ${h.title}`;

    const l2Items = (h.subheadings || []).map((s, j) => {
      const l2Num = `${l1Num}.${j + 1}`;
      const l3Items = (s.subheadings || []).map((ss, k) => ({
        level: 3 as const,
        title: `${l2Num}.${k + 1} ${ss.title}`,
      }));
      return {
        level: 2 as const,
        title: `${l2Num} ${s.title}`,
        children: l3Items.length > 0 ? l3Items : undefined,
      };
    });

    return {
      id: String(i + 1),
      title: numberedTitle,
      content: "",
      structure: l2Items.length > 0
        ? [{ level: 1, title: numberedTitle, children: l2Items }]
        : [{ level: 1, title: numberedTitle }],
    };
  });
}

// ═══════════════════════════════════════════════════════════════
// 可编辑大纲标题组件
// ═══════════════════════════════════════════════════════════════

interface EditableHeadingItemProps {
  heading: OutlineHeading;
  index: number;
  depth: 1 | 2 | 3;
  onChange: (id: string, newTitle: string) => void;
  onDelete: (id: string) => void;
  onAddBelow: (id: string) => void;
  onSubCountChange: (id: string, count: number) => void;
  showSubCount?: boolean;
}

function EditableHeadingItem({
  heading,
  index,
  depth,
  onChange,
  onDelete,
  onAddBelow,
  onSubCountChange,
  showSubCount,
}: EditableHeadingItemProps) {
  const { t } = useI18n();
  const indentClass = depth === 1 ? "ml-0" : depth === 2 ? "ml-8" : "ml-16";

  return (
    <div className={`group flex items-center gap-2 rounded-md border p-2 ${indentClass}`}>
      {/* 序号 */}
      <span className="w-6 shrink-0 text-center text-xs font-medium text-muted-foreground">
        {index + 1}
      </span>

      {/* 标题输入 */}
      <Input
        value={heading.title}
        onChange={(e) => onChange(heading.id, e.target.value)}
        className="h-8 flex-1 text-sm"
        placeholder={`${t.writing.headingLabel(depth)}...`}
      />

      {/* 子标题数量选择器 */}
      {showSubCount && (
        <div className="flex shrink-0 items-center gap-1">
          <span className="text-muted-foreground whitespace-nowrap text-xs">
            {t.writing.subheading}
          </span>
          <Select
            value={String(heading.subCount)}
            onValueChange={(v) => onSubCountChange(heading.id, Number(v))}
          >
            <SelectTrigger className="h-7 w-16 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 10 }, (_, i) => (
                <SelectItem key={i} value={String(i)} className="text-xs">
  {i}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* 操作按钮 */}
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          className="text-muted-foreground hover:text-primary rounded p-1 transition-colors"
          onClick={() => onAddBelow(heading.id)}
          title={t.writing.insertBelow}
        >
          <Plus className="size-3.5" />
        </button>
        <button
          className="text-muted-foreground hover:text-red-500 rounded p-1 transition-colors"
          onClick={() => onDelete(heading.id)}
          title={t.writing.delete}
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// 可编辑大纲树组件
// ═══════════════════════════════════════════════════════════════

interface EditableOutlineProps {
  headings: OutlineHeading[];
  depth: 1 | 2 | 3;
  showSubCount?: boolean;
  generating?: boolean;
  headingLabel: string;
  onGenerate: () => void;
  onHeadingsChange: (headings: OutlineHeading[]) => void;
  onSubCountChange?: (id: string, count: number) => void;
  /** 内部重新生成按钮的文案，默认根据 depth 显示"生成二级标题"/"生成三级标题" */
  generateButtonLabel?: string;
  /** 是否显示内部的重新生成按钮（外部已有同功能按钮时隐藏） */
  hideGenerateButton?: boolean;
}

function EditableOutline({
  headings,
  depth,
  showSubCount,
  generating,
  headingLabel,
  onGenerate,
  onHeadingsChange,
  onSubCountChange,
  generateButtonLabel,
  hideGenerateButton,
}: EditableOutlineProps) {
  const { t } = useI18n();
  const handleTitleChange = useCallback(
    (id: string, newTitle: string) => {
      onHeadingsChange(
        headings.map((h) => (h.id === id ? { ...h, title: newTitle } : h)),
      );
    },
    [headings, onHeadingsChange],
  );

  const handleDelete = useCallback(
    (id: string) => {
      onHeadingsChange(headings.filter((h) => h.id !== id));
    },
    [headings, onHeadingsChange],
  );

  const handleAddBelow = useCallback(
    (id: string) => {
      const idx = headings.findIndex((h) => h.id === id);
      const newHeading: OutlineHeading = {
        id: `h_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        title: "",
        subCount: 0,
        subheadings: [],
      };
      const updated = [...headings];
      updated.splice(idx + 1, 0, newHeading);
      onHeadingsChange(updated);
    },
    [headings, onHeadingsChange],
  );

  const handleSubCountChange = useCallback(
    (id: string, count: number) => {
      const updated = headings.map((h) =>
        h.id === id ? { ...h, subCount: count } : h,
      );
      onHeadingsChange(updated);
      onSubCountChange?.(id, count);
    },
    [headings, onHeadingsChange, onSubCountChange],
  );

  const handleAddLast = useCallback(() => {
    const newHeading: OutlineHeading = {
      id: `h_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      title: "",
      subCount: 0,
      subheadings: [],
    };
    onHeadingsChange([...headings, newHeading]);
  }, [headings, onHeadingsChange]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">{headingLabel}</h3>
          {generating && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" /> AI {t.writing.generating}...
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={handleAddLast}
            disabled={generating}
          >
            <Plus className="mr-1 size-3" /> {t.writing.add}
          </Button>
          {!generating && headings.length === 0 && (
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={onGenerate}
            >
              <Sparkles className="mr-1 size-3" /> {t.writing.aiGenerate}
            </Button>
          )}
        </div>
      </div>

      {/* 标题列表 */}
      <div className="space-y-1.5">
        {headings.map((h, i) => (
          <EditableHeadingItem
            key={h.id}
            heading={h}
            index={i}
            depth={depth}
            onChange={handleTitleChange}
            onDelete={handleDelete}
            onAddBelow={handleAddBelow}
            onSubCountChange={handleSubCountChange}
            showSubCount={showSubCount}
          />
        ))}
      </div>

      {/* AI 重新生成按钮（已有标题时） */}
      {!generating && headings.length > 0 && depth < 3 && !hideGenerateButton && (
        <Button
          className="w-full"
          variant="outline"
          size="sm"
          onClick={onGenerate}
        >
          <Sparkles className="mr-2 size-3" />
          {generateButtonLabel ||
            (depth === 1
              ? t.writing.l1Generate
              : depth === 2
                ? t.writing.l2Generate
                : t.writing.l3Generate)}
        </Button>
      )}

      {generating && (
        <div className="flex items-center justify-center gap-2 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {t.writing.generatingLabel.replace("{label}", headingLabel)}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// 从零开始 - 大纲生成向导
// ═══════════════════════════════════════════════════════════════

type WizardStep = "info" | "l1" | "l2" | "l3";

function FromScratchWizard({ onBack }: { onBack?: () => void }) {
  const { t } = useI18n();
  const state = useWritingState();
  const dispatch = useWritingDispatch();

  const router = useRouter();

  const [wizardStep, setWizardStep] = useState<WizardStep>("info");

  // 三级大纲数据
  const [level1Headings, setLevel1Headings] = useState<OutlineHeading[]>([]);
  const [level2Headings, setLevel2Headings] = useState<OutlineHeading[]>([]);
  const [level3Headings, setLevel3Headings] = useState<OutlineHeading[]>([]);

  // 生成状态
  const [generatingL1, setGeneratingL1] = useState(false);
  const [generatingL2, setGeneratingL2] = useState(false);
  const [generatingL3, setGeneratingL3] = useState(false);

  // 知识库集合列表
  const [collections, setCollections] = useState<Array<{ id: string; name: string }>>([]);

  // 创建草稿中
  const [creating, setCreating] = useState(false);

  // ── 加载知识库集合列表 ──────────────────────────────────────────
  useEffect(() => {
    listCollections().then(setCollections).catch(() => {});
  }, []);

  // ── 生成一级大纲 ──────────────────────────────────────────────
  const handleGenerateL1 = useCallback(async () => {
    if (!state.projectName.trim()) {
      toast.warning("请先填写项目名称/主题");
      return;
    }
    setGeneratingL1(true);
    try {
      const res = await generateOutline({
        project_name: state.projectName,
        doc_type: state.docType,
        description: state.description || undefined,
        model_name: state.modelName || undefined,
      });
      if (res.success && res.chapters?.length) {
        const l1: OutlineHeading[] = res.chapters.map(
          (ch: { id: string; title: string }) => ({
            id: ch.id || `l1_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            title: ch.title || "",
            subCount: 0,
            subheadings: [],
          }),
        );
        setLevel1Headings(l1);
        setWizardStep("l1");
        toast.success(`已生成 ${l1.length} 个一级标题`);
      } else {
        toast.error("大纲生成失败：AI 返回为空，请重试");
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "未知错误";
      toast.error(`大纲生成失败：${msg}`);
      console.error("[大纲生成] API 错误:", e);
    } finally {
      setGeneratingL1(false);
    }
  }, [state.projectName, state.docType, state.description]);

  // ── 生成二级大纲 ──────────────────────────────────────────────
  const handleGenerateL2 = useCallback(async () => {
    const parentsNeedingSub = level1Headings.filter((h) => h.subCount > 0);
    if (parentsNeedingSub.length === 0) {
      setLevel2Headings([]);
      setWizardStep("l2");
      return;
    }
    setGeneratingL2(true);
    try {
      const existing = level1Headings.map((h) => ({
        id: h.id,
        title: h.title,
        subCount: h.subCount,
      }));

      const res = await generateOutline({
        project_name: state.projectName,
        doc_type: state.docType,
        existing_structure: existing,
        model_name: state.modelName || undefined,
      });

      if (res.success && res.chapters?.length) {
        const l2: OutlineHeading[] = [];
        for (const parent of level1Headings) {
          if (parent.subCount <= 0) continue;
          const matchCh = res.chapters.find(
            (ch: { id?: string; title?: string; sub_titles?: string[] }) =>
              ch.title === parent.title || ch.id === parent.id,
          );
          const subTitles = (matchCh as { sub_titles?: string[] })?.sub_titles || [];
          for (let i = 0; i < Math.min(parent.subCount, subTitles.length); i++) {
            l2.push({
              id: `l2_${parent.id}_${i + 1}`,
              title: subTitles[i] || "",
              subCount: 0,
              subheadings: [],
            });
          }
          for (let i = subTitles.length; i < parent.subCount; i++) {
            l2.push({
              id: `l2_${parent.id}_${i + 1}`,
              title: "",
              subCount: 0,
              subheadings: [],
            });
          }
        }
        setLevel2Headings(l2);
        setWizardStep("l2");
        toast.success(`已生成 ${l2.length} 个二级标题`);
      } else {
        toast.error("二级标题生成失败：AI 返回为空，请重试");
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "未知错误";
      toast.error(`二级标题生成失败：${msg}`);
      console.error("[大纲生成 L2] API 错误:", e);
    } finally {
      setGeneratingL2(false);
    }
  }, [level1Headings, state.projectName, state.docType]);

  // ── 生成三级大纲 ──────────────────────────────────────────────
  const handleGenerateL3 = useCallback(async () => {
    const parentsNeedingSub = level2Headings.filter((h) => h.subCount > 0);
    if (parentsNeedingSub.length === 0) {
      setLevel3Headings([]);
      setWizardStep("l3");
      return;
    }
    setGeneratingL3(true);
    try {
      // 构建 existing_structure：一级 -> 二级（含 subCount）
      const existing = level1Headings.map((l1) => ({
        id: l1.id,
        title: l1.title,
        subCount: l1.subCount,
        children: level2Headings
          .filter((l2) => l2.id.startsWith(`l2_${l1.id}_`))
          .map((l2) => ({
            id: l2.id,
            title: l2.title,
            subCount: l2.subCount,
          })),
      }));

      const res = await generateOutline({
        project_name: state.projectName,
        doc_type: state.docType,
        existing_structure: existing,
        model_name: state.modelName || undefined,
      });

      if (res.success && res.chapters?.length) {
        const l3: OutlineHeading[] = [];
        for (const l2 of level2Headings) {
          if (l2.subCount <= 0) continue;
          const extracted: string[] = [];
          // 从 API 响应中遍历所有章节的 sub_titles，找到匹配的二级标题提取三级
          for (const ch of res.chapters as Array<{
            title?: string;
            sub_titles?: Array<string | { title: string; sub_titles?: string[] }>;
          }>) {
            const subs = ch.sub_titles || [];
            for (const sub of subs) {
              const subTitle = typeof sub === "string" ? sub : sub.title;
              if (subTitle === l2.title) {
                // 匹配到当前二级标题
                if (typeof sub === "object" && sub.sub_titles) {
                  for (const t3 of sub.sub_titles) {
                    if (typeof t3 === "string" && t3.trim()) extracted.push(t3.trim());
                  }
                }
                break;
              }
            }
            if (extracted.length > 0) break;
          }
          for (let i = 0; i < Math.min(l2.subCount, extracted.length); i++) {
            l3.push({ id: `l3_${l2.id}_${i + 1}`, title: extracted[i] || "", subCount: 0 });
          }
          for (let i = extracted.length; i < l2.subCount; i++) {
            l3.push({ id: `l3_${l2.id}_${i + 1}`, title: "", subCount: 0 });
          }
        }
        setLevel3Headings(l3);
        setWizardStep("l3");
        toast.success(`已生成 ${l3.filter((h) => h.title).length} 个三级标题`);
      } else {
        toast.error("三级标题生成失败：AI 返回为空，请重试");
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "未知错误";
      toast.error(`三级标题生成失败：${msg}`);
      console.error("[大纲生成 L3] API 错误:", e);
    } finally {
      setGeneratingL3(false);
    }
  }, [level1Headings, level2Headings, state.projectName, state.docType]);

  // ── 构建完整大纲树 ────────────────────────────────────────────
  const buildFullOutline = useCallback((): OutlineHeading[] => {
    return level1Headings.map((l1) => {
      const l2Children = level2Headings.filter(
        (l2) => l2.id.startsWith(`l2_${l1.id}_`),
      );
      const children: OutlineHeading[] | undefined = l2Children.length
        ? l2Children.map((l2) => {
            const l3Children = level3Headings.filter(
              (l3) => l3.id.startsWith(`l3_${l2.id}_`),
            );
            return {
              ...l2,
              subheadings: l3Children.length ? l3Children : undefined,
            };
          })
        : undefined;
      return { ...l1, subheadings: children };
    });
  }, [level1Headings, level2Headings, level3Headings]);

  // ── L2 subCount 变化回调 ──────────────────────────────────────
  const handleL2SubCountChange = useCallback(
    (id: string, count: number) => {
      setLevel2Headings((prev) =>
        prev.map((h) => (h.id === id ? { ...h, subCount: count } : h)),
      );
    },
    [],
  );

  // ── 创建草稿并跳转 ────────────────────────────────────────────
  const handleCreateDraft = useCallback(async () => {
    setCreating(true);
    try {
      const fullOutline = buildFullOutline();
      const chapters = outlineToChapters(fullOutline);

      if (chapters.length === 0) {
        toast.warning("请至少保留一个章节");
        return;
      }

      const res = await createDraft({
        project_name: state.projectName,
        doc_type: state.docType,
        mode: "from-scratch",
        kb_collection_id: state.kbCollectionId || undefined,
      });

      if (!res.success || !res.draft?.id) {
        toast.error("创建草稿失败");
        return;
      }

      const draftId = res.draft.id as number;

      // 保存章节 + 标记待生成
      await updateDraftApi(draftId, {
        chapters: chapters as unknown[],
        description: state.description || undefined,
        stage: "writing",
        kb_collection_id: state.kbCollectionId || undefined,
        generation_state: {
          status: "generating",
          pending_chapters: chapters.map((_, i) => i),
          failed_chapters: [],
          generated_chapters: [],
        },
      });

      router.push(`/workspace/writing/${draftId}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "创建草稿失败";
      toast.error(msg);
    } finally {
      setCreating(false);
    }
  }, [state.projectName, state.docType, state.description, buildFullOutline, router]);

  // ── 渲染：基本信息填写 ─────────────────────────────────────────
  if (wizardStep === "info") {
    return (
      <div className="flex w-full max-w-xl flex-col gap-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack}>
            {t.writing.back}
          </Button>
          <h2 className="text-xl font-semibold">{t.writing.fromScratch}</h2>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium">{t.writing.step1Name}</label>
            <Input
              placeholder={t.writing.step1Placeholder}
              value={state.projectName}
              onChange={(e) => dispatch({ type: "SET_PROJECT_NAME", payload: e.target.value })}
              className="mt-1"
            />
          </div>

          <div>
            <label className="text-sm font-medium">{t.writing.step2DocType}</label>
            <Select
              value={state.docType}
              onValueChange={(v) => dispatch({ type: "SET_DOC_TYPE", payload: v })}
            >
              <SelectTrigger className="mt-1">
                <SelectValue placeholder={t.writing.step2Placeholder} />
              </SelectTrigger>
              <SelectContent>
                {DOC_TYPES.map((dt) => (
                  <SelectItem key={dt.value} value={dt.value}>
                    {dt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-sm font-medium">{t.writing.step3Description}</label>
            <Textarea
              placeholder={t.writing.step3Placeholder}
              className="mt-1 min-h-[100px]"
              value={state.description}
              onChange={(e) => dispatch({ type: "SET_DESCRIPTION", payload: e.target.value })}
            />
          </div>

          <div>
            <label className="text-sm font-medium">{t.writing.linkKnowledgeBase}</label>
            <Select
              value={state.kbCollectionId || "__none__"}
              onValueChange={(v) => dispatch({ type: "SET_KB_COLLECTION", payload: v === "__none__" ? "" : v })}
            >
              <SelectTrigger className="mt-1">
                <SelectValue placeholder={t.writing.noKnowledgeBase} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">{t.writing.noKnowledgeBase}</SelectItem>
                {collections.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              {t.writing.linkKnowledgeBaseHint}
            </p>
          </div>
        </div>

        <Button
          className="w-full"
          size="lg"
          disabled={!state.projectName.trim() || generatingL1}
          onClick={handleGenerateL1}
        >
          {generatingL1 ? (
            <><Loader2 className="mr-2 size-4 animate-spin" /> {t.writing.generatingOutline}</>
          ) : (
            <><Sparkles className="mr-2 size-4" /> {t.writing.generateOutline} <ArrowRight className="ml-2 size-4" /></>
          )}
        </Button>
      </div>
    );
  }

  // ── 渲染：一级标题编辑 + 二级数量选择 ──────────────────────────
  if (wizardStep === "l1") {
    return (
      <div className="flex w-full max-w-2xl flex-col gap-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setWizardStep("info")}>
            {t.writing.back}
          </Button>
          <h2 className="text-xl font-semibold">{t.writing.editL1Title}</h2>
          <span className="ml-auto text-xs text-muted-foreground">
            {t.writing.stepLabel.replace("{current}", "1").replace("{total}", "3").replace("{level}", t.writing.headingLabel(1))}
          </span>
        </div>

        <p className="text-sm text-muted-foreground">
          {t.writing.editL1Hint}
        </p>

        <EditableOutline
          headings={level1Headings}
          depth={1}
          showSubCount
          generating={generatingL1}
          headingLabel={t.writing.headingLabel(1)}
          onGenerate={handleGenerateL1}
          onHeadingsChange={setLevel1Headings}
          generateButtonLabel={t.writing.regenerateL1}
          hideGenerateButton
        />

        <Button
          className="w-full"
          size="lg"
          disabled={level1Headings.length === 0 || generatingL2}
          onClick={handleGenerateL2}
        >
          {generatingL2 ? (
            <><Loader2 className="mr-2 size-4 animate-spin" /> {t.writing.generatingLabel.replace("{label}", t.writing.headingLabel(2))}</>
          ) : (
            <><Sparkles className="mr-2 size-4" /> {t.writing.l1Generate} <ArrowRight className="ml-2 size-4" /></>
          )}
        </Button>
      </div>
    );
  }

  // ── 渲染：二级标题编辑 + 三级数量选择 ──────────────────────────
  if (wizardStep === "l2") {
    // 将 level2Headings 按 parent 分组显示
    const getL2ForParent = (parentId: string) =>
      level2Headings.filter((h) => h.id.startsWith(`l2_${parentId}_`));

    return (
      <div className="flex w-full max-w-2xl flex-col gap-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setWizardStep("l1")}>
            {t.writing.back}
          </Button>
          <h2 className="text-xl font-semibold">{t.writing.editL2Title}</h2>
          <span className="ml-auto text-xs text-muted-foreground">
            {t.writing.stepLabel.replace("{current}", "2").replace("{total}", "3").replace("{level}", t.writing.headingLabel(2))}
          </span>
        </div>

        <p className="text-sm text-muted-foreground">
          {t.writing.editL2Hint}
        </p>

        <div className="space-y-4">
          {level1Headings.map((l1) => {
            const l2Children = getL2ForParent(l1.id);
            if (l2Children.length === 0 && l1.subCount === 0) return null;
            if (l2Children.length === 0) {
              return (
                <div key={l1.id} className="rounded-md border p-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      {level1Headings.indexOf(l1) + 1}.
                    </span>
                    <span className="text-sm font-medium">{l1.title}</span>
                    <span className="text-xs text-muted-foreground">{t.writing.noSubheadings.replace("{level}", t.writing.headingLabel(2))}</span>
                  </div>
                </div>
              );
            }
            return (
              <div key={l1.id} className="rounded-md border p-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    {level1Headings.indexOf(l1) + 1}.
                  </span>
                  <span className="text-sm font-medium">{l1.title}</span>
                </div>
                <EditableOutline
                  headings={l2Children}
                  depth={2}
                  showSubCount
                  generating={generatingL2}
                  headingLabel=""
                  onGenerate={() => {}}
                  onHeadingsChange={(updated) => {
                    setLevel2Headings((prev) => {
                      const other = prev.filter(
                        (h) => !h.id.startsWith(`l2_${l1.id}_`),
                      );
                      return [...other, ...updated];
                    });
                  }}
                  onSubCountChange={handleL2SubCountChange}
                  hideGenerateButton
                />
              </div>
            );
          })}
        </div>

        <Button
          className="w-full"
          size="lg"
          disabled={generatingL3}
          onClick={handleGenerateL3}
        >
          {generatingL3 ? (
            <><Loader2 className="mr-2 size-4 animate-spin" /> {t.writing.generatingLabel.replace("{label}", t.writing.headingLabel(3))}</>
          ) : (
            <><Sparkles className="mr-2 size-4" /> {t.writing.l2Generate} <ArrowRight className="ml-2 size-4" /></>
          )}
        </Button>
      </div>
    );
  }

  // ── 渲染：三级标题编辑 + 完成 ─────────────────────────────────
  if (wizardStep === "l3") {
    const getL3ForL2 = (l2Id: string) =>
      level3Headings.filter((h) => h.id.startsWith(`l3_${l2Id}_`));

    return (
      <div className="flex w-full max-w-2xl flex-col gap-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setWizardStep("l2")}>
            {t.writing.back}
          </Button>
          <h2 className="text-xl font-semibold">{t.writing.editL3Title}</h2>
          <span className="ml-auto text-xs text-muted-foreground">
            {t.writing.stepLabel.replace("{current}", "3").replace("{total}", "3").replace("{level}", t.writing.headingLabel(3))}
          </span>
        </div>

        <p className="text-sm text-muted-foreground">
          {t.writing.editL3Hint}
        </p>

        <div className="space-y-4">
          {level1Headings.map((l1) => {
            const l1Idx = level1Headings.indexOf(l1);
            const l2Children = level2Headings.filter((h) =>
              h.id.startsWith(`l2_${l1.id}_`),
            );
            if (l2Children.length === 0 && l1.subCount === 0) return null;
            return (
              <div key={l1.id} className="rounded-md border p-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    {l1Idx + 1}.
                  </span>
                  <span className="text-sm font-medium">{l1.title}</span>
                </div>
                {l2Children.map((l2) => {
                  const l3Children = getL3ForL2(l2.id);
                  return (
                    <div key={l2.id} className="ml-8 mt-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {l1Idx + 1}.{l2Children.indexOf(l2) + 1}
                        </span>
                        <span className="text-sm">{l2.title || t.writing.unnamed}</span>
                        {l2.subCount > 0 && l3Children.length === 0 && (
                          <span className="text-xs text-muted-foreground">{t.writing.noSubheadings.replace("{level}", t.writing.headingLabel(3))}</span>
                        )}
                      </div>
                      {l3Children.length > 0 && (
                        <EditableOutline
                          headings={l3Children}
                          depth={3}
                          showSubCount={false}
                          generating={generatingL3}
                          headingLabel=""
                          onGenerate={() => {}}
                          onHeadingsChange={(updated) => {
                            setLevel3Headings((prev) => {
                              const other = prev.filter(
                                (h) => !h.id.startsWith(`l3_${l2.id}_`),
                              );
                              return [...other, ...updated];
                            });
                          }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        <Button
          className="w-full"
          size="lg"
          disabled={creating || level1Headings.length === 0}
          onClick={handleCreateDraft}
        >
          {creating ? (
            <><Loader2 className="mr-2 size-4 animate-spin" /> {t.writing.creatingDocument}</>
          ) : (
            <><FileText className="mr-2 size-4" /> {t.writing.createDocument} <ArrowRight className="ml-2 size-4" /></>
          )}
        </Button>
      </div>
    );
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════
// StageOne 主组件
// ═══════════════════════════════════════════════════════════════

export function StageOne() {
  const { t } = useI18n();
  const state = useWritingState();
  const dispatch = useWritingDispatch();
  const router = useRouter();
  const [step, setStep] = useState<"choose" | "from-scratch" | "upload-template">("choose");

  const handleModeSelect = (mode: "from-scratch" | "upload-template") => {
    dispatch({ type: "SET_MODE", payload: mode });
    setStep(mode);
  };

  // ── Choose mode screen ──────────────────────────────────────────────
  if (step === "choose") {
    return (
      <div className="flex h-full w-full items-center justify-center p-8">
        <div className="flex w-full max-w-2xl flex-col gap-8">
          <div className="text-center">
            <h1 className="text-2xl font-bold">{t.writing.title}</h1>
            <p className="text-muted-foreground mt-2">{t.writing.chooseMode}</p>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <Card
              className="cursor-pointer transition-all hover:border-primary/50 hover:shadow-md"
              onClick={() => handleModeSelect("from-scratch")}
            >
              <CardHeader>
                <FileText className="text-primary mb-2 size-8" />
                <CardTitle>{t.writing.fromScratch}</CardTitle>
                <CardDescription>{t.writing.fromScratchDesc}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-muted-foreground text-xs">
                  {t.writing.fromScratchHint}
                </div>
              </CardContent>
            </Card>

            <Card
              className="cursor-pointer transition-all hover:border-primary/50 hover:shadow-md"
              onClick={() => handleModeSelect("upload-template")}
            >
              <CardHeader>
                <FileUp className="text-primary mb-2 size-8" />
                <CardTitle>{t.writing.uploadTemplate}</CardTitle>
                <CardDescription>{t.writing.uploadTemplateDesc}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-muted-foreground text-xs">
                  {t.writing.uploadTemplateHint}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  // ── 从零开始（大纲生成向导） ───────────────────────────────────
  if (step === "from-scratch") {
    return (
      <div className="flex h-full w-full items-start justify-center overflow-y-auto p-8">
        <FromScratchWizard onBack={() => { setStep("choose"); dispatch({ type: "SET_MODE", payload: null }); }} />
      </div>
    );
  }

  // ── 上传模板 ─────────────────────────────────────────────────────────
  if (step === "upload-template") {
    return (
      <UploadTemplateUI onBack={() => { setStep("choose"); dispatch({ type: "SET_MODE", payload: null }); }} />
    );
  }
}

// ═══════════════════════════════════════════════════════════════
// 上传模板组件（保持不变）
// ═══════════════════════════════════════════════════════════════

function UploadTemplateUI({ onBack }: { onBack?: () => void }) {
  const { t } = useI18n();
  const state = useWritingState();
  const dispatch = useWritingDispatch();
  const router = useRouter();
  const templateRef = useRef<HTMLInputElement>(null);
  const descRef = useRef<HTMLInputElement>(null);
  const formatRef = useRef<HTMLInputElement>(null);
  const [formatText, setFormatText] = useState("");
  const [uploading, setUploading] = useState<string | null>(null);
  const [kbCollections, setKbCollections] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    listCollections().then(setKbCollections).catch(() => {});
  }, []);

  const handleFileSelect = async (
    e: ChangeEvent<HTMLInputElement>,
    fileType: "template" | "description" | "format",
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(fileType);
    try {
      const result = await uploadWritingFile(file);
      dispatch({
        type: "ADD_FILE",
        payload: { name: result.filename, path: result.path, type: fileType },
      });
      toast.success(`${fileType === "template" ? "模板" : fileType === "description" ? "对象说明" : "格式文件"}上传成功`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "上传失败";
      toast.error(msg);
    } finally {
      setUploading(null);
    }
  };

  const handleRemoveFile = (fileType: string) => {
    const existing = state.files.find((f) => f.type === fileType);
    if (existing) {
      dispatch({ type: "REMOVE_FILE", payload: existing.path });
    }
  };

  const [starting, setStarting] = useState(false);
  const handleStartWriting = async () => {
    const templateFile = state.files.find((f) => f.type === "template");
    if (!templateFile) return;
    setStarting(true);
    try {
      const { parseTemplate, createDraft: apiCreateDraft, updateDraft: apiUpdateDraft } = await import("@/core/writing/api");

      // 1. 创建草稿，先保存项目信息和文件
      const draftRes = await apiCreateDraft({
        project_name: state.projectName || t.writing.untitled,
        doc_type: state.docType,
        mode: "upload-template",
        kb_collection_id: state.kbCollectionId || undefined,
      });
      if (!draftRes.success || !draftRes.draft?.id) {
        toast.error("创建草稿失败");
        return;
      }
      const draftId = draftRes.draft.id as number;

      // 2. 保存文件信息
      await apiUpdateDraft(draftId, {
        files: state.files as unknown[],
        stage: "start",
        kb_collection_id: state.kbCollectionId || undefined,
      });

      // 3. 解析模板获取章节
      const tmpl = await parseTemplate({ template_path: templateFile.path });
      const chapters = tmpl.chapters.map((ch) => {
        // content 只放标题结构，不塞模板原文（原文放 bodyText 供 AI 参考）
        // AI 未生成前编辑器显示加载态，不暴露原文
        const bodyText = ch.body_text || "";

        // ★★★ 关键修复：parseTemplate 返回的 structure 是直接 level-2 的数组，
        //     但 generate_content（后端 service.py）期望的是
        //     [{level:1, title, children: [level-2, ...]}] 的格式（与从零开始模式一致）。
        //     这里做一次包装，确保后端能正确解析出二级/三级标题。★★★
        const rawStructure = ch.structure || [];
        const wrappedStructure = rawStructure.length > 0
          ? [{ level: 1, title: ch.title, children: rawStructure }]
          : [];

        let initContent = "";
        if (wrappedStructure.length > 0) {
          initContent = wrappedStructure
            .map((item: { level: number; title: string; children?: Array<{ level: number; title: string; children?: Array<{ level: number; title: string }> }> }) => {
              let html = `<h${item.level}>${item.title}</h${item.level}>`;
              if (item.children) {
                html += "\n" + item.children
                  .map((child: { level: number; title: string; children?: Array<{ level: number; title: string }> }) => {
                    let childHtml = `<h${child.level}>${child.title}</h${child.level}>`;
                    if (child.children) {
                      childHtml += "\n" + child.children
                        .map((gc: { level: number; title: string }) => `<h${gc.level}>${gc.title}</h${gc.level}>`)
                        .join("\n");
                    }
                    return childHtml;
                  })
                  .join("\n");
              }
              return html;
            })
            .join("\n\n");
        }
        return { id: ch.id, title: ch.title, content: initContent, structure: wrappedStructure, bodyText };
      });

      // 4. 保存章节并标记 writing 阶段
      await apiUpdateDraft(draftId, {
        chapters: chapters as unknown[],
        description: state.description || undefined,
        stage: "writing",
        generation_state: {
          status: "generating",
          pending_chapters: chapters.map((_: unknown, i: number) => i),
          failed_chapters: [],
          generated_chapters: [],
        },
      });

      // 5. 跳转到草稿编辑页
      router.push(`/workspace/writing/${draftId}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "模板解析失败";
      toast.error(msg);
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="flex h-full w-full items-center justify-center p-8">
      <div className="flex w-full max-w-xl flex-col gap-6">
        <div className="flex items-center gap-3">
          <button
            className="text-muted-foreground hover:text-foreground text-sm transition-colors"
            onClick={onBack}
          >
            {t.writing.back}
          </button>
          <h2 className="text-xl font-semibold">{t.writing.uploadTemplateTitle}</h2>
        </div>

        <div className="space-y-4">
          {/* ── Word 模板 ─────────────────────────────────────────────── */}
          <UploadCard
            title={t.writing.wordTemplate}
            required
            description={t.writing.wordTemplateDesc}
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            fileType="template"
            currentFile={state.files.find((f) => f.type === "template")}
            inputRef={templateRef}
            onSelect={(e) => handleFileSelect(e, "template")}
            onRemove={() => handleRemoveFile("template")}
            uploading={uploading === "template"}
          />

          {/* ── 对象说明 ─────────────────────────────────────────────── */}
          <UploadCard
            title={t.writing.objectDescription}
            required
            description={t.writing.objectDescriptionDesc}
            accept=".md,.doc,.docx,.txt"
            fileType="description"
            currentFile={state.files.find((f) => f.type === "description")}
            inputRef={descRef}
            onSelect={(e) => handleFileSelect(e, "description")}
            onRemove={() => handleRemoveFile("description")}
            uploading={uploading === "description"}
          />

          {/* ── 关联知识库 ─────────────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t.writing.linkKnowledgeBase}</CardTitle>
              <CardDescription>{t.writing.linkKnowledgeBaseHint}</CardDescription>
            </CardHeader>
            <CardContent>
              <Select
                value={state.kbCollectionId || "__none__"}
                onValueChange={(v) => dispatch({ type: "SET_KB_COLLECTION", payload: v === "__none__" ? "" : v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t.writing.noKnowledgeBase} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t.writing.noKnowledgeBase}</SelectItem>
                  {kbCollections.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {/* ── 格式要求 ─────────────────────────────────────────────── */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{t.writing.formatRequirements}</CardTitle>
                <span className="text-xs text-muted-foreground">{t.writing.optional}</span>
              </div>
              <CardDescription>{t.writing.formatRequirementsHint}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <div
                className="border-muted flex cursor-pointer items-center gap-2 rounded-md border p-3 hover:bg-muted/50"
                onClick={() => formatRef.current?.click()}
              >
                <input
                  ref={formatRef}
                  type="file"
                  accept=".md,.doc,.docx,.txt"
                  className="hidden"
                  onChange={(e) => handleFileSelect(e, "format")}
                />
                {state.files.find((f) => f.type === "format") ? (
                  <>
                    <Check className="size-5 text-green-600" />
                    <span className="text-sm">
                      {state.files.find((f) => f.type === "format")?.name}
                    </span>
                    <button
                      className="ml-auto text-muted-foreground hover:text-red-500"
                      onClick={(e) => { e.stopPropagation(); handleRemoveFile("format"); }}
                    >
                      <X className="size-4" />
                    </button>
                  </>
                ) : (
                  <>
                    <Upload className="size-5 shrink-0" />
                    <span className="text-sm">{t.writing.uploadFormatFile}</span>
                  </>
                )}
              </div>
              <div className="text-muted-foreground text-center text-xs">{t.writing.or}</div>
              <Textarea
                placeholder={t.writing.formatPlaceholder}
                className="min-h-[80px]"
                value={formatText}
                onChange={(e) => setFormatText(e.target.value)}
              />
            </CardContent>
          </Card>
        </div>

        <Button
          className="w-full"
          size="lg"
          disabled={!state.files.find((f) => f.type === "template") || starting}
          onClick={handleStartWriting}
        >
          {starting ? (
            <><Loader2 className="mr-2 size-4 animate-spin" /> {t.writing.parseTemplate}</>
          ) : (
            <><ArrowRight className="mr-2 size-4" /> {t.writing.startWriting}</>
          )}
        </Button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// 可复用的上传卡片组件
// ═══════════════════════════════════════════════════════════════

interface UploadCardProps {
  title: string;
  required?: boolean;
  description: string;
  accept: string;
  fileType: string;
  currentFile?: { name: string; path: string };
  inputRef: React.RefObject<HTMLInputElement | null>;
  onSelect: (e: ChangeEvent<HTMLInputElement>) => void;
  onRemove: () => void;
  uploading?: boolean;
}

function UploadCard({
  title,
  required,
  description,
  accept,
  fileType,
  currentFile,
  inputRef,
  onSelect,
  onRemove,
  uploading,
}: UploadCardProps) {
  const { t } = useI18n();
  const label = currentFile ? currentFile.name : t.writing.uploadFile.replace("{type}", title);
  return (
    <Card className={currentFile ? "border-primary" : ""}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{title}</CardTitle>
          {required && !currentFile && <span className="text-xs text-red-500">{t.writing.required}</span>}
          {currentFile && <span className="text-xs text-green-600">已上传</span>}
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div
          className="border-muted flex cursor-pointer items-center gap-2 rounded-md border p-3 hover:bg-muted/50"
          onClick={() => { if (!uploading) inputRef.current?.click(); }}
        >
          <input
            ref={inputRef}
            type="file"
            accept={accept}
            className="hidden"
            onChange={onSelect}
          />
          {uploading ? (
            <>
              <Loader2 className="size-5 shrink-0 animate-spin" />
              <span className="text-sm">上传中...</span>
            </>
          ) : currentFile ? (
            <>
              <Check className="size-5 shrink-0 text-green-600" />
              <span className="flex-1 truncate text-sm">{label}</span>
              <button
                className="text-muted-foreground hover:text-red-500"
                onClick={(e) => { e.stopPropagation(); onRemove(); }}
              >
                <X className="size-4" />
              </button>
            </>
          ) : (
            <>
              <Upload className="size-5 shrink-0" />
              <span className="text-sm">{label}</span>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
