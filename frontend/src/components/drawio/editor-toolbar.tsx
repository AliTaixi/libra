"use client";

interface EditorToolbarProps {
  fileName: string;
}

/**
 * 极简工具栏——只显示文件名
 */
export function EditorToolbar({
  fileName,
}: EditorToolbarProps) {
  return (
    <div className="flex shrink-0 items-center border-b px-4 py-1.5">
      <span className="truncate text-sm font-medium">{fileName}</span>
    </div>
  );
}
