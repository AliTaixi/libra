"use client";

import { SparklesIcon, LockIcon, Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Item,
  ItemActions,
  ItemTitle,
  ItemContent,
  ItemDescription,
} from "@/components/ui/item";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/core/i18n/hooks";
import { useDeleteSkill, useEnableSkill, useSkills } from "@/core/skills/hooks";
import type { Skill } from "@/core/skills/type";
import { env } from "@/env";

import { SettingsSection } from "./settings-section";

export function SkillSettingsPage({ onClose }: { onClose?: () => void } = {}) {
  const { t } = useI18n();
  const { skills, isLoading, error } = useSkills();
  return (
    <SettingsSection
      title={t.settings.skills.title}
      description={t.settings.skills.description}
    >
      {isLoading ? (
        <div className="text-muted-foreground text-sm">{t.common.loading}</div>
      ) : error ? (
        <div>Error: {error.message}</div>
      ) : (
        <SkillSettingsList skills={skills} onClose={onClose} />
      )}
    </SettingsSection>
  );
}

function SkillSettingsList({
  skills,
  onClose,
}: {
  skills: Skill[];
  onClose?: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const { mutate: enableSkill } = useEnableSkill();
  const { mutate: deleteSkill } = useDeleteSkill();
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const handleCreateSkill = () => {
    onClose?.();
    router.push("/workspace/chats/new?mode=skill");
  };
  return (
    <div className="flex w-full flex-col gap-4">
      <header className="flex justify-between">
        <div className="flex gap-2">
          <h3 className="text-sm font-medium text-muted-foreground">
            所有技能（{skills.length}）
          </h3>
        </div>
        <div>
          <Button size="sm" onClick={handleCreateSkill}>
            <SparklesIcon className="size-4" />
            {t.settings.skills.createSkill}
          </Button>
        </div>
      </header>
      {skills.length === 0 ? (
        <EmptySkill onCreateSkill={handleCreateSkill} />
      ) : (
        skills.map((skill) => {
          const isPublic = skill.category === "public";
          return (
            <Item
              className={`w-full ${isPublic ? "border-l-4 border-l-yellow-400 bg-yellow-50/40 dark:bg-yellow-950/10" : ""}`}
              variant="outline"
              key={skill.name}
            >
              <ItemContent>
                <ItemTitle>
                  <div className="flex items-center gap-2">
                    {skill.name}
                    {isPublic && (
                      <span className="rounded bg-yellow-200 px-1.5 py-0.5 text-[10px] font-medium text-yellow-800 dark:bg-yellow-800 dark:text-yellow-200">
                        公共
                      </span>
                    )}
                  </div>
                </ItemTitle>
                <ItemDescription className="line-clamp-4">
                  {skill.description}
                </ItemDescription>
              </ItemContent>
              {isPublic ? (
                <ItemActions>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <LockIcon className="size-3" />
                    系统内置
                  </span>
                </ItemActions>
              ) : (
                <ItemActions>
                  <div className="flex items-center gap-1">
                    <Switch
                      checked={skill.enabled}
                      disabled={env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true"}
                      onCheckedChange={(checked) =>
                        enableSkill({ skillName: skill.name, enabled: checked })
                      }
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="text-destructive hover:text-destructive h-8 w-8 shrink-0"
                      onClick={() => setDeleteTarget(skill.name)}
                      title="删除技能"
                    >
                      <Trash2Icon className="size-3.5" />
                    </Button>
                  </div>
                </ItemActions>
              )}
            </Item>
          );
        })
      )}

      {/* 删除确认对话框 */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除技能</DialogTitle>
            <DialogDescription>
              确定要删除「{deleteTarget}」吗？此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteTarget) {
                  deleteSkill(deleteTarget, {
                    onSuccess: () => {
                      toast.success(`技能「${deleteTarget}」已删除`);
                      setDeleteTarget(null);
                    },
                    onError: (err) => {
                      toast.error(err instanceof Error ? err.message : "删除失败");
                    },
                  });
                }
              }}
            >
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmptySkill({ onCreateSkill }: { onCreateSkill: () => void }) {
  const { t } = useI18n();
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SparklesIcon />
        </EmptyMedia>
        <EmptyTitle>{t.settings.skills.emptyTitle}</EmptyTitle>
        <EmptyDescription>
          {t.settings.skills.emptyDescription}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button onClick={onCreateSkill}>{t.settings.skills.emptyButton}</Button>
      </EmptyContent>
    </Empty>
  );
}
