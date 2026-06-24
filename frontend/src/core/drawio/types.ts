/**
 * draw.io 集成相关类型定义
 */

/** draw.io iframe 发出的消息事件 */
export interface DrawioMessageEvent {
  event: "init" | "save" | "export" | "configure" | "title" | "dirty" | "autosave";
  xml?: string;
  title?: string;
  dirty?: boolean;
}

/** 发送给 draw.io iframe 的动作 */
export interface DrawioRequest {
  action: "load" | "export" | "configure" | "save";
  xml?: string;
  format?: "xml" | "png" | "svg";
  spin?: string;
  title?: string;
}

/** AI 助手聊天消息 */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  /** 仅 assistant 消息有：生成的 draw.io XML */
  drawioXml?: string;
  /** 消息时间戳 */
  timestamp: number;
}

/** AI 生成请求 */
export interface AIGenerateRequest {
  /** 用户输入的描述 */
  prompt: string;
  /** 当前图表的 XML（用于修改已有图表） */
  currentXml?: string;
  /** 使用的模型名称 */
  modelName?: string;
}

/** AI 生成响应 */
export interface AIGenerateResponse {
  /** 生成的 draw.io XML */
  xml: string;
  /** 原始 LLM 响应文本 */
  rawContent: string;
  /** 是否成功 */
  success: boolean;
  error?: string;
}

/** 图表文件元数据 */
export interface DiagramFile {
  id: string;
  title: string;
  xml: string;
  createdAt: number;
  updatedAt: number;
}

/** draw.io 嵌入配置 */
export interface DrawioEmbedConfig {
  /** draw.io 服务地址，默认 http://localhost:8080 */
  baseUrl?: string;
  /** 是否隐藏菜单栏 */
  hideMenu?: boolean;
  /** 初始 XML */
  initialXml?: string;
  /** 标题 */
  title?: string;
}
