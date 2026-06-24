"use client";

import { Trash2Icon, UsersIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { useAuth } from "@/core/auth/AuthProvider";
import { fetch as authFetch, getCsrfHeaders } from "@/core/api/fetcher";
import { useI18n } from "@/core/i18n/hooks";

import { SettingsSection } from "./settings-section";

interface ManagedUser {
  id: string;
  email: string;
  system_role: "admin" | "user" | "super";
  created_at: string;
}

export function UserManagement() {
  const { user, isPrivileged } = useAuth();
  const { t } = useI18n();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<ManagedUser | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchUsers = useCallback(async () => {
    try {
      setLoading(true);
      const res = await authFetch("/api/v1/auth/users", {
        credentials: "include",
      });
      if (res.ok) {
        const data = (await res.json()) as ManagedUser[];
        setUsers(data);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isPrivileged) {
      fetchUsers();
    }
  }, [isPrivileged, fetchUsers]);

  if (!isPrivileged) return null;

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await authFetch(`/api/v1/auth/users/${deleteTarget.id}`, {
        method: "DELETE",
        headers: { ...getCsrfHeaders() },
        credentials: "include",
      });
      if (res.ok) {
        toast.success(`已删除用户 ${deleteTarget.email}`);
        setUsers((prev) => prev.filter((u) => u.id !== deleteTarget.id));
        setDeleteTarget(null);
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(
          (data as { detail?: string }).detail || "删除失败",
        );
      }
    } catch {
      toast.error("网络错误");
    } finally {
      setDeleting(false);
    }
  };

  // 只显示普通用户，不显示管理员/超级管理员（也不显示自己）
  const regularUsers = users.filter(
    (u) => u.system_role === "user" && u.id !== user?.id,
  );

  return (
    <SettingsSection
      title={t.settings.account.userManagement || "账号管理"}
      description={t.settings.account.userManagementDescription || "管理普通用户账号"}
    >
      {loading ? (
        <div className="text-muted-foreground text-sm">
          {t.common.loading}
        </div>
      ) : regularUsers.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UsersIcon />
            </EmptyMedia>
            <EmptyTitle>暂无普通用户</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="space-y-2">
          {regularUsers.map((u) => (
            <UserRow
              key={u.id}
              user={u}
              currentRole={user?.system_role}
              onDelete={setDeleteTarget}
            />
          ))}
        </div>
      )}

      {/* 删除确认对话框 */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>删除用户</DialogTitle>
            <DialogDescription>
              确定要删除用户「{deleteTarget?.email}」吗？此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? "删除中..." : "删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsSection>
  );
}

function UserRow({
  user: u,
  currentRole,
  onDelete,
}: {
  user: ManagedUser;
  currentRole?: string;
  onDelete: (user: ManagedUser) => void;
}) {
  const roleLabel =
    u.system_role === "super"
      ? "超级管理员"
      : u.system_role === "admin"
        ? "管理员"
        : "用户";

  return (
    <div className="flex items-center justify-between rounded-md border px-4 py-2.5 text-sm">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="truncate font-medium">{u.email}</span>
        <span className="bg-muted shrink-0 rounded px-1.5 py-0.5 text-xs">
          {roleLabel}
        </span>
      </div>
      <div className="ml-2 shrink-0">
        <Button
          size="icon"
          variant="ghost"
          className="text-destructive hover:text-destructive h-8 w-8"
          onClick={() => onDelete(u)}
          title="删除用户"
        >
          <Trash2Icon className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
