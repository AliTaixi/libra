/**
 * draw.io AI 生成 API
 * 与后端 LLM 通信，生成/修改 draw.io XML
 */

import { getBackendBaseURL } from "../config";
import { fetch as authFetch } from "../api/fetcher";

import type { AIGenerateRequest, AIGenerateResponse } from "./types";

/**
 * 调用 LLM 生成 draw.io 图表 XML
 *
 * 将用户的自然语言描述 + 当前图表 XML（可选）发送给 LLM，
 * 返回 draw.io 原生 XML 格式，可直接注入编辑器
 */
export async function generateDiagram(
  req: AIGenerateRequest,
): Promise<AIGenerateResponse> {
  try {
    const response = await authFetch(
      `${getBackendBaseURL()}/api/drawio/generate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: req.prompt,
          current_xml: req.currentXml,
          model_name: req.modelName,
        }),
      },
    );

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      return {
        xml: "",
        rawContent: "",
        success: false,
        error: `HTTP ${response.status}: ${errorBody.slice(0, 200)}`,
      };
    }

    const data = await response.json();
    return {
      xml: data.xml ?? "",
      rawContent: data.raw_content ?? data.xml ?? "",
      success: true,
    };
  } catch (err) {
    return {
      xml: "",
      rawContent: "",
      success: false,
      error: err instanceof Error ? err.message : "未知错误",
    };
  }
}

/**
 * 流式生成 draw.io 图表（用于 AI 面板逐字展示推理过程）
 * 返回 ReadableStream，调用方自行处理
 */
export async function* streamGenerateDiagram(
  req: AIGenerateRequest,
): AsyncGenerator<string> {
  const response = await authFetch(
    `${getBackendBaseURL()}/api/drawio/generate/stream`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: req.prompt,
        current_xml: req.currentXml,
        model_name: req.modelName,
      }),
    },
  );

  if (!response.ok || !response.body) {
    yield `错误: HTTP ${response.status}`;
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    yield decoder.decode(value, { stream: true });
  }
}
