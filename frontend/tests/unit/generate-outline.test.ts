/**
 * generateOutline API 测试
 *
 * 测试前端 generateOutline 函数是否正确发送请求和处理响应。
 * 后端实际响应需要通过集成测试验证（见 tests/e2e/api-test.mjs）。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock 全局 fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock document.cookie (CSRF token 读取)
vi.stubGlobal("document", {
  cookie: "",
});

describe("generateOutline API", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("应发送正确的请求体到 /api/writing/generate-outline", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        chapters: [
          { id: "1", title: "需求分析", description: "分析项目需求" },
          { id: "2", title: "系统设计", description: "总体架构设计" },
        ],
      }),
    });

    const { generateOutline } = await import("@/core/writing/api");

    const result = await generateOutline({
      project_name: "某型雷达软件",
      doc_type: "spec",
      description: "重点描述软件架构",
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);

    const callUrl = mockFetch.mock.calls[0]?.[0] as string;
    expect(callUrl).toContain("/api/writing/generate-outline");

    const callOptions = mockFetch.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(callOptions.body as string);
    expect(body.project_name).toBe("某型雷达软件");
    expect(body.doc_type).toBe("spec");
    expect(body.description).toBe("重点描述软件架构");

    expect(result.success).toBe(true);
    expect(result.chapters).toHaveLength(2);
    expect(result.chapters[0].title).toBe("需求分析");
  });

  it("应在后端返回 422 时抛出异常", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({ detail: "不支持的文档类型" }),
    });

    const { generateOutline } = await import("@/core/writing/api");

    await expect(
      generateOutline({
        project_name: "测试",
        doc_type: "invalid_type",
      }),
    ).rejects.toThrow("不支持的文档类型");
  });

  it("应在网络错误时抛出异常", async () => {
    mockFetch.mockRejectedValueOnce(new Error("NetworkError"));

    const { generateOutline } = await import("@/core/writing/api");

    await expect(
      generateOutline({
        project_name: "测试",
        doc_type: "report",
      }),
    ).rejects.toThrow("NetworkError");
  });
});
