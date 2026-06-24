import {
  BookOpenTextIcon,
  CompassIcon,
  FileCodeIcon,
  FileCogIcon,
  FilePlayIcon,
  FileTextIcon,
  ImageIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

const extensionMap: Record<string, string> = {
  // Text
  txt: "text",
  csv: "csv",
  log: "text",
  conf: "text",
  config: "text",
  properties: "text",
  props: "text",

  // JavaScript/TypeScript ecosystem
  js: "javascript",
  jsx: "jsx",
  ts: "typescript",
  tsx: "tsx",
  mjs: "javascript",
  cjs: "javascript",
  mts: "typescript",
  cts: "typescript",

  // Web
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  sass: "sass",
  less: "less",
  vue: "vue",
  svelte: "svelte",
  astro: "astro",

  // Python
  py: "python",
  pyi: "python",
  pyw: "python",

  // Java/JVM
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  scala: "scala",
  groovy: "groovy",

  // C/C++
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hxx: "cpp",
  hh: "cpp",

  // C#
  cs: "csharp",

  // Go
  go: "go",

  // Rust
  rs: "rust",

  // Ruby
  rb: "ruby",
  rake: "ruby",

  // PHP
  php: "php",

  // Shell/Bash
  sh: "bash",
  bash: "bash",
  zsh: "zsh",
  fish: "fish",

  // Config & Data
  json: "json",
  jsonc: "jsonc",
  json5: "json5",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  xml: "xml",
  ini: "ini",
  env: "dotenv",

  // Markdown & Docs
  md: "markdown",
  mdx: "mdx",
  rst: "rst",

  // SQL
  sql: "sql",

  // Other languages
  swift: "swift",
  dart: "dart",
  lua: "lua",
  r: "r",
  matlab: "matlab",
  julia: "jl",
  elm: "elm",
  haskell: "haskell",
  hs: "haskell",
  elixir: "elixir",
  ex: "elixir",
  clj: "clojure",
  cljs: "clojure",

  // Infrastructure
  dockerfile: "dockerfile",
  docker: "docker",
  tf: "terraform",
  tfvars: "terraform",
  hcl: "hcl",

  // Build & Config
  makefile: "makefile",
  cmake: "cmake",
  gradle: "groovy",

  // Git
  gitignore: "git-commit",
  gitattributes: "git-commit",

  // Misc
  graphql: "graphql",
  gql: "graphql",
  proto: "protobuf",
  prisma: "prisma",
  wasm: "wasm",
  zig: "zig",
  v: "v",
};

export function getFileName(filepath: string) {
  return filepath.split("/").pop()!;
}

export function getFileExtension(filepath: string) {
  return filepath.split(".").pop()!.toLocaleLowerCase();
}

export function checkCodeFile(
  filepath: string,
):
  | { isCodeFile: true; language: string }
  | { isCodeFile: false; language: null } {
  const extension = getFileExtension(filepath);
  const isCodeFile = extension in extensionMap;
  if (isCodeFile) {
    return {
      isCodeFile: true,
      language: extensionMap[extension] ?? "text",
    };
  }
  return {
    isCodeFile: false,
    language: null,
  };
}

export function getFileExtensionDisplayName(filepath: string) {
  const fileName = getFileName(filepath);
  const extension = fileName.split(".").pop()!.toLocaleLowerCase();
  switch (extension) {
    case "doc":
    case "docx":
      return "Word";
    case "md":
      return "Markdown";
    case "txt":
      return "Text";
    case "ppt":
    case "pptx":
      return "PowerPoint";
    case "xls":
    case "xlsx":
      return "Excel";
    default:
      return extension.toUpperCase();
  }
}

export function getFileIcon(filepath: string, className?: string) {
  const extension = getFileExtension(filepath);
  const { isCodeFile } = checkCodeFile(filepath);
  switch (extension) {
    case "skill":
      return <FileCogIcon className={className} />;
    case "html":
      return <CompassIcon className={className} />;
    case "txt":
    case "md":
      return <BookOpenTextIcon className={className} />;
    case "jpg":
    case "jpeg":
    case "png":
    case "gif":
    case "bmp":
    case "tiff":
    case "ico":
    case "webp":
    case "svg":
    case "heic":
      return <ImageIcon className={className} />;
    case "mp3":
    case "wav":
    case "ogg":
    case "aac":
    case "m4a":
    case "flac":
    case "wma":
    case "aiff":
    case "ape":
    case "mp4":
    case "mov":
    case "m4v":
      return <FilePlayIcon className={className} />;
    default:
      if (isCodeFile) {
        return <FileCodeIcon className={className} />;
      }
      return <FileTextIcon className={className} />;
  }
}

// ── File type categories ─────────────────────────────────────────────

export type FileCategory = "docx" | "pdf-png-svg" | "md" | "other";

export interface FileCategoryInfo {
  key: FileCategory;
  label: string;
  icon: LucideIcon;
  extensions: string[];
}

export const FILE_CATEGORIES: FileCategoryInfo[] = [
  {
    key: "docx",
    label: "DOCX 文档",
    icon: FileTextIcon,
    extensions: ["docx"],
  },
  {
    key: "pdf-png-svg",
    label: "PDF / PNG / SVG",
    icon: ImageIcon,
    extensions: ["pdf", "png", "svg"],
  },
  {
    key: "md",
    label: "Markdown",
    icon: BookOpenTextIcon,
    extensions: ["md"],
  },
  {
    key: "other",
    label: "其他",
    icon: FileTextIcon,
    extensions: [], // catch-all
  },
];

export function getFileCategory(filename: string): FileCategory {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  for (const cat of FILE_CATEGORIES) {
    if (cat.extensions.includes(ext)) return cat.key;
  }
  return "other";
}

export function getCategoryLabel(key: FileCategory): string {
  return FILE_CATEGORIES.find((c) => c.key === key)?.label ?? "其他";
}

export function getCategoryIcon(key: FileCategory, className?: string) {
  const Icon = FILE_CATEGORIES.find((c) => c.key === key)?.icon ?? FileTextIcon;
  return <Icon className={className} />;
}

/** Group files by category, preserving category order. */
export function groupFilesByCategory(
  files: { filename: string }[],
): { category: FileCategory; files: typeof files }[] {
  const groups = new Map<FileCategory, typeof files>();
  for (const cat of FILE_CATEGORIES) groups.set(cat.key, []);
  for (const file of files) {
    const cat = getFileCategory(file.filename);
    groups.get(cat)!.push(file);
  }
  return FILE_CATEGORIES.map((c) => ({ category: c.key, files: groups.get(c.key)! })).filter(
    (g) => g.files.length > 0,
  );
}
