"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, FileText } from "lucide-react";

import { cn } from "@/lib/utils";
import type { KBTreeNode } from "@/core/knowledge-base/types";

interface TreeNodeProps {
  node: KBTreeNode;
  level: number;
  defaultExpanded?: boolean;
}

function TreeNode({ node, level, defaultExpanded = false }: TreeNodeProps) {
  const children = node.nodes ?? [];
  const hasChildren = children.length > 0;
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className="w-full">
      <div
        className={cn(
          "flex items-start gap-1 rounded-md py-1.5 pr-2 transition-colors hover:bg-accent/50",
          hasChildren && "cursor-pointer",
        )}
        style={{ paddingLeft: `${level * 16}px` }}
        onClick={() => hasChildren && setExpanded(!expanded)}
      >
        {hasChildren ? (
          <button
            type="button"
            className="mt-0.5 shrink-0 text-muted-foreground"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
          >
            {expanded ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
          </button>
        ) : (
          <span className="mt-0.5 shrink-0 px-0.5">
            <FileText className="size-3.5 text-muted-foreground" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{node.title}</span>
            {node.line_num !== undefined && (
              <span className="text-muted-foreground text-xs">
                第{node.line_num}行
              </span>
            )}
          </div>
          {(node.summary || node.prefix_summary) && (
            <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">
              {node.summary || node.prefix_summary}
            </p>
          )}
          {node.node_id && (
            <span className="text-muted-foreground/60 mt-0.5 block text-[10px]">
              ID: {node.node_id}
            </span>
          )}
        </div>
      </div>
      {hasChildren && expanded && (
        <div className="mt-0.5">
          {children.map((child) => (
            <TreeNode
              key={child.node_id}
              node={child}
              level={level + 1}
              defaultExpanded={level < 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface TreeViewerProps {
  /** Array of root-level tree nodes from PageIndex */
  nodes: KBTreeNode[];
  className?: string;
}

export function TreeViewer({ nodes, className }: TreeViewerProps) {
  if (!nodes || nodes.length === 0) {
    return (
      <div className={cn("py-4 text-center text-sm text-muted-foreground", className)}>
        暂无树结构
      </div>
    );
  }

  return (
    <div className={cn("w-full", className)}>
      {nodes.map((node) => (
        <TreeNode key={node.node_id} node={node} level={0} defaultExpanded />
      ))}
    </div>
  );
}
