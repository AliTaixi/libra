"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BookOpen, Loader2, Plus, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useAuth } from "@/core/auth/AuthProvider";
import { listCollections } from "@/core/knowledge-base/client";
import type { KBCollection } from "@/core/knowledge-base/types";

export default function KnowledgeBaseLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  const router = useRouter();
  const { isPrivileged, isAuthenticated } = useAuth();

  // 非管理员/超级管理员用户无法访问知识库
  useEffect(() => {
    if (isAuthenticated && !isPrivileged) {
      router.replace("/workspace");
    }
  }, [isAuthenticated, isPrivileged, router]);

  if (isAuthenticated && !isPrivileged) {
    return null;
  }
  const [collections, setCollections] = useState<KBCollection[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchCollections = async () => {
      setLoading(true);
      try {
        const data = await listCollections();
        setCollections(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error("获取集合列表失败:", err);
        setCollections([]);
      } finally {
        setLoading(false);
      }
    };
    fetchCollections();
  }, []);

  return (
    <div className="flex h-full w-full">
      {/* 侧边栏 */}
      <aside className="flex w-64 shrink-0 flex-col border-r bg-muted/30">
        <div className="flex items-center justify-between p-4">
          <h2 className="text-sm font-semibold">知识库</h2>
          <Button size="sm" variant="ghost" asChild>
            <Link href="/workspace/knowledge-base/new">
              <Plus className="size-4" />
            </Link>
          </Button>
        </div>
        <Separator />
        <ScrollArea className="flex-1">
          <div className="p-2">
            {loading ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <Loader2 className="mr-2 size-4 animate-spin" />
                加载中...
              </div>
            ) : collections.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                <BookOpen className="mx-auto mb-2 size-8 opacity-30" />
                <p>暂无集合</p>
                <Button size="sm" variant="link" asChild className="mt-2">
                  <Link href="/workspace/knowledge-base/new">创建集合</Link>
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {collections.map((collection) => {
                  const isActive = pathname?.startsWith(
                    `/workspace/knowledge-base/collections/${collection.id}`,
                  );
                  return (
                    <Link
                      key={collection.id}
                      href={`/workspace/knowledge-base/collections/${collection.id}`}
                      className={cn(
                        "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                        isActive
                          ? "bg-accent text-accent-foreground"
                          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                      )}
                    >
                      <BookOpen className="size-4 shrink-0" />
                      <span className="truncate">{collection.name}</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </ScrollArea>
      </aside>

      {/* 主内容区 */}
      <main className="flex min-w-0 flex-1 flex-col">{children}</main>
    </div>
  );
}
