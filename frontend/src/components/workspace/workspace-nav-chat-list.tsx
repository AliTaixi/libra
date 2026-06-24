"use client";

import { BotIcon, LibraryBig, PenLine, Shapes } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useAuth } from "@/core/auth/AuthProvider";
import { useI18n } from "@/core/i18n/hooks";

export function WorkspaceNavChatList() {
  const { t } = useI18n();
  const pathname = usePathname();
  const { isPrivileged } = useAuth();
  return (
    <SidebarGroup className="pt-1">
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={pathname.startsWith("/workspace/agents")}
            asChild
          >
            <Link className="text-muted-foreground" href="/workspace/agents">
              <BotIcon />
              <span>{t.sidebar.agents}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={pathname.startsWith("/workspace/writing")}
            asChild
          >
            <Link className="text-muted-foreground" href="/workspace/writing">
              <PenLine />
              <span>{t.sidebar.writing}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={pathname.startsWith("/workspace/drawio")}
            asChild
          >
            <Link className="text-muted-foreground" href="/workspace/drawio">
              <Shapes />
              <span>{t.sidebar.drawio}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
        {/* 仅管理员/超级管理员可见知识库 */}
        {isPrivileged && (
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={pathname.startsWith("/workspace/knowledge-base")}
              asChild
            >
              <Link className="text-muted-foreground" href="/workspace/knowledge-base">
                <LibraryBig />
                <span>{t.sidebar.knowledgeBase}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        )}
      </SidebarMenu>
    </SidebarGroup>
  );
}
