/**
 * 全文写作 API 客户端
 * 与后端 /api/writing/* 端点通信
 */

import { getBackendBaseURL } from "../config";
import { fetch as authFetch } from "../api/fetcher";

/** 从失败的 HTTP 响应中提取错误详情，兼容 JSON 和非 JSON 响应体 */
async function parseErrorDetail(response: Response): Promise<string> {
  const status = response.status;
  try {
    const json = await response.json();
    return json.detail ?? JSON.stringify(json);
  } catch {
    try {
      const text = await response.text();
      return text.slice(0, 200);
    } catch {
      return `HTTP ${status} (无法读取响应体)`;
    }
  }
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await authFetch(`${getBackendBaseURL()}/api/writing${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await parseErrorDetail(response)}`);
  }
  return response.json();
}

async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const response = await authFetch(`${getBackendBaseURL()}/api/writing${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await parseErrorDetail(response)}`);
  }
  return response.json();
}

export interface UploadFileResponse {
  success: boolean;
  filename: string;
  path: string;
  size: number;
}

export async function uploadWritingFile(file: File): Promise<UploadFileResponse> {
  const formData = new FormData();
  formData.append("file", file);
  const response = await authFetch(`${getBackendBaseURL()}/api/writing/upload`, {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await parseErrorDetail(response)}`);
  }
  return response.json();
}

// ── 图表生成 ──────────────────────────────────────────────────────────────

export interface ChartGenerateRequest {
  tool: string;
  chart_type: string;
  data: string[];
  x?: string;
  y?: string;
  title?: string;
  xlabel?: string;
  ylabel?: string;
}

export interface ChartGenerateResponse {
  svg_content: string;
  success: boolean;
}

export function generateChart(req: ChartGenerateRequest) {
  return apiPost<ChartGenerateResponse>("/generate-chart", req);
}

// ── 框架图生成 ────────────────────────────────────────────────────────────

export interface DiagramGenerateRequest {
  mermaid_code: string;
}

export interface DiagramGenerateResponse {
  svg_content: string;
  success: boolean;
}

export function generateDiagram(req: DiagramGenerateRequest) {
  return apiPost<DiagramGenerateResponse>("/generate-diagram", req);
}

// ── 文档导出 ──────────────────────────────────────────────────────────────

export interface ChapterExportItem {
  title: string;
  content: string;
}

export interface ExportDocxRequest {
  template_path: string;
  chapters: ChapterExportItem[];
  markdown?: string;
  output_name?: string;
}

export interface ExportDocxResponse {
  file_path: string;
  success: boolean;
}

export function exportDocx(req: ExportDocxRequest) {
  return apiPost<ExportDocxResponse>("/export-docx", req);
}

// ── 模板解析 ──────────────────────────────────────────────────────────────

export interface ParseTemplateRequest {
  template_path: string;
}

export interface ChapterInfo {
  id: string;
  title: string;
  sub_titles?: string[];
  description?: string;
  structure?: StructureItem[];
  body_text?: string;
}

export interface ParseTemplateResponse {
  chapters: ChapterInfo[];
  variables: string[];
  success: boolean;
}

export function parseTemplate(req: ParseTemplateRequest) {
  return apiPost<ParseTemplateResponse>("/parse-template", req);
}

// ── 大纲生成 ──────────────────────────────────────────────────────────────

export interface GenerateOutlineRequest {
  project_name: string;
  doc_type: string;
  description?: string;
  /** 已有章节结构，用于 L2/L3 逐级生成。每项包含 {id, title, subCount, children?} */
  existing_structure?: Array<{ id: string; title: string; subCount: number; children?: Array<{ id: string; title: string; subCount: number }> }>;
  model_name?: string;
}

export interface GenerateOutlineResponse {
  chapters: ChapterInfo[];
  success: boolean;
}

export function generateOutline(req: GenerateOutlineRequest) {
  return apiPost<GenerateOutlineResponse>("/generate-outline", req);
}

// ── AI 内容生成 ──────────────────────────────────────────────────────────

export interface StructureItem {
  level: number;
  title: string;
  children?: StructureItem[];
}

export interface GenerateContentRequest {
  chapter_title: string;
  chapter_description?: string;
  project_name?: string;
  doc_type?: string;
  context?: string;
  word_count?: number;
  structure?: StructureItem[];
  model_name?: string;
}

export interface GenerateContentResponse {
  content: string;
  success: boolean;
}

export interface BatchGenerateContentRequest {
  chapters: GenerateContentRequest[];
}

export interface BatchGenerateContentResponse {
  contents: GenerateContentResponse[];
  success: boolean;
}

export function generateContent(req: GenerateContentRequest) {
  return apiPost<GenerateContentResponse>("/generate-content", req);
}

export function batchGenerateContent(req: BatchGenerateContentRequest) {
  return apiPost<BatchGenerateContentResponse>("/batch-generate-content", req);
}

// ── 内容修改 ────────────────────────────────────────────────────────────

export interface ReviseContentRequest {
  original_content: string;
  demand: string;
  chapter_title?: string;
  word_count_min?: number;
  word_count_max?: number;
  model_name?: string;
}

export interface ReviseContentResponse {
  content: string;
  success: boolean;
}

export function reviseContent(req: ReviseContentRequest) {
  return apiPost<ReviseContentResponse>("/revise-content", req);
}

// ── 从原文直接生成图表/框架图（合并端点，无需前端提取数据）─────────

export interface ChartFromTextRequest {
  text: string;
  chart_type: string;
  title?: string;
  model_name?: string;
}

export function generateChartFromText(req: ChartFromTextRequest) {
  return apiPost<ChartGenerateResponse>("/generate-chart-from-text", req);
}

export interface DiagramFromTextRequest {
  text: string;
  diagram_type: string;
  model_name?: string;
}

export function generateDiagramFromText(req: DiagramFromTextRequest) {
  return apiPost<DiagramGenerateResponse>("/generate-diagram-from-text", req);
}

// ── AI 智能表格生成 ──────────────────────────────────────────────────

export interface GenerateTableRequest {
  text: string;
  model_name?: string;
}

export interface GenerateTableResponse {
  table_html: string;
  caption: string;
  success: boolean;
}

export function generateTableFromText(req: GenerateTableRequest) {
  return apiPost<GenerateTableResponse>("/generate-table-from-text", req);
}

// ── AI 智能可视化生成 ──────────────────────────────────────────────────

export interface AiGenerateVisualRequest {
  text: string;
  model_name?: string;
}

export interface AiGenerateVisualResponse {
  content: string;
  content_type: "svg" | "html";
  caption: string;
  success: boolean;
}

export function aiGenerateVisual(req: AiGenerateVisualRequest) {
  return apiPost<AiGenerateVisualResponse>("/ai-generate-visual", req);
}

// ── AI 数据提取（图表生成前调用）─────────────────────────────────────

export interface ExtractChartDataRequest {
  text: string;
  chart_type: string;
  model_name?: string;
}

export interface ExtractChartDataResponse {
  data: string[];
  x: string;
  /** Y 轴标签（热力图行名），| 分隔 */
  y: string;
  title: string;
  xlabel: string;
  ylabel: string;
  success: boolean;
}

export function extractChartData(req: ExtractChartDataRequest) {
  return apiPost<ExtractChartDataResponse>("/extract-chart-data", req);
}

export interface ExtractDiagramCodeRequest {
  text: string;
  diagram_type: string;
  model_name?: string;
}

export interface ExtractDiagramCodeResponse {
  mermaid_code: string;
  success: boolean;
}

export function extractDiagramCode(req: ExtractDiagramCodeRequest) {
  return apiPost<ExtractDiagramCodeResponse>("/extract-diagram-code", req);
}

// ═══════════════════════════════════════════════════════════════
// 草稿持久化 CRUD
// ═══════════════════════════════════════════════════════════════

export interface DraftCreateRequest {
  project_name?: string;
  doc_type?: string;
  mode?: string | null;
  model_name?: string;
  kb_collection_id?: string;
}

export interface DraftUpdateRequest {
  project_name?: string | null;
  doc_type?: string | null;
  description?: string | null;
  mode?: string | null;
  stage?: string | null;
  files?: unknown[] | null;
  chapters?: unknown[] | null;
  word_count_min?: number | null;
  word_count_max?: number | null;
  demand_input?: string | null;
  finished?: boolean | null;
  generation_state?: Record<string, unknown> | null;
  model_name?: string | null;
  kb_collection_id?: string | null;
}

export interface DraftResponse {
  draft?: Record<string, unknown> | null;
  success: boolean;
}

export interface DraftListResponse {
  drafts: Record<string, unknown>[];
  success: boolean;
}

export interface DraftDeleteResponse {
  success: boolean;
}

export interface ResumeResponse {
  status: string;
  message: string;
  success: boolean;
}

export interface StatusResponse {
  generation_state: Record<string, unknown>;
  chapters: unknown[];
  success: boolean;
}

export async function createDraft(req: DraftCreateRequest): Promise<DraftResponse> {
  return apiPost<DraftResponse>("/drafts", req);
}

export async function listDrafts(limit = 50, offset = 0): Promise<DraftListResponse> {
  const response = await authFetch(
    `${getBackendBaseURL()}/api/writing/drafts?limit=${limit}&offset=${offset}`,
    { method: "GET", headers: { "Content-Type": "application/json" } },
  );
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await parseErrorDetail(response)}`);
  }
  return response.json();
}

export async function getDraft(draftId: number): Promise<DraftResponse> {
  const response = await authFetch(
    `${getBackendBaseURL()}/api/writing/drafts/${draftId}`,
    { method: "GET", headers: { "Content-Type": "application/json" } },
  );
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await parseErrorDetail(response)}`);
  }
  return response.json();
}

export async function updateDraft(draftId: number, req: DraftUpdateRequest): Promise<DraftResponse> {
  return apiPut<DraftResponse>(`/drafts/${draftId}`, req);
}

export async function deleteDraft(draftId: number): Promise<DraftDeleteResponse> {
  const response = await authFetch(
    `${getBackendBaseURL()}/api/writing/drafts/${draftId}`,
    { method: "DELETE" },
  );
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await parseErrorDetail(response)}`);
  }
  return response.json();
}

export async function resumeGeneration(draftId: number): Promise<ResumeResponse> {
  return apiPost<ResumeResponse>(`/drafts/${draftId}/resume`, {});
}

export async function getGenerationStatus(draftId: number): Promise<StatusResponse> {
  const response = await authFetch(
    `${getBackendBaseURL()}/api/writing/drafts/${draftId}/status`,
    { method: "GET", headers: { "Content-Type": "application/json" } },
  );
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await parseErrorDetail(response)}`);
  }
  return response.json();
}


