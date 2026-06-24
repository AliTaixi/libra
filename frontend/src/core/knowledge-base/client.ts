/** 知识库 API 客户端 — 与后端 /api/kb/* 端点通信 */

import { getBackendBaseURL } from "@/core/config";
import { fetch as authFetch } from "@/core/api/fetcher";
import type {
  CreateCollectionRequest,
  CreateDocumentRequest,
  IndexDocumentResponse,
  KBCollection,
  KBDocument,
  KBTreeIndex,
  QueryRequest,
  QueryResponse,
  SSEEvent,
  UpdateCollectionRequest,
  UpdateDocumentRequest,
  UploadContentRequest,
} from "./types";

const KB_BASE_PATH = "/api/kb";

function getBaseUrl(): string {
  const backend = getBackendBaseURL();
  if (backend) return `${backend}${KB_BASE_PATH}`;
  return KB_BASE_PATH;
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await authFetch(`${getBaseUrl()}${path}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await authFetch(`${getBaseUrl()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

async function apiPut<T>(path: string, body?: unknown): Promise<T> {
  const res = await authFetch(`${getBaseUrl()}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

async function apiDelete<T>(path: string): Promise<T> {
  const res = await authFetch(`${getBaseUrl()}${path}`, { method: "DELETE" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

// ═══════════════════════════════════════════════════════════════
// 集合 CRUD
// ═══════════════════════════════════════════════════════════════

export async function listCollections(): Promise<KBCollection[]> {
  return apiGet<KBCollection[]>("/collections");
}

export async function createCollection(req: CreateCollectionRequest): Promise<KBCollection> {
  return apiPost<KBCollection>("/collections", req);
}

export async function getCollection(collectionId: string): Promise<KBCollection> {
  return apiGet<KBCollection>(`/collections/${collectionId}`);
}

export async function updateCollection(
  collectionId: string,
  req: UpdateCollectionRequest,
): Promise<KBCollection> {
  return apiPut<KBCollection>(`/collections/${collectionId}`, req);
}

export async function deleteCollection(collectionId: string): Promise<{ success: boolean }> {
  return apiDelete<{ success: boolean }>(`/collections/${collectionId}`);
}

// ═══════════════════════════════════════════════════════════════
// 文档 CRUD
// ═══════════════════════════════════════════════════════════════

export async function listDocuments(collectionId: string): Promise<KBDocument[]> {
  return apiGet<KBDocument[]>(`/collections/${collectionId}/documents`);
}

export async function createDocument(
  collectionId: string,
  req: CreateDocumentRequest,
): Promise<KBDocument> {
  return apiPost<KBDocument>(`/collections/${collectionId}/documents`, req);
}

export async function getDocument(documentId: string): Promise<KBDocument> {
  return apiGet<KBDocument>(`/documents/${documentId}`);
}

export async function updateDocument(
  documentId: string,
  req: UpdateDocumentRequest,
): Promise<KBDocument> {
  return apiPut<KBDocument>(`/documents/${documentId}`, req);
}

export async function deleteDocument(documentId: string): Promise<{ success: boolean }> {
  return apiPost<{ success: boolean }>(`/documents/${documentId}/delete`);
}

export async function uploadDocumentContent(
  documentId: string,
  req: UploadContentRequest,
): Promise<IndexDocumentResponse> {
  return apiPost<IndexDocumentResponse>(`/documents/${documentId}/upload`, req);
}

export async function uploadDocumentFile(
  documentId: string,
  file: File,
  modelName?: string,
): Promise<IndexDocumentResponse> {
  const formData = new FormData();
  formData.append("file", file);
  if (modelName) formData.append("model_name", modelName);
  // Use authFetch so CSRF token is automatically injected for POST
  const res = await authFetch(`${getBaseUrl()}/documents/${documentId}/upload-file`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function indexDocument(
  documentId: string,
  modelName?: string,
): Promise<IndexDocumentResponse> {
  const body: Record<string, unknown> = {};
  if (modelName) body.model_name = modelName;
  return apiPost<IndexDocumentResponse>(`/documents/${documentId}/index`, body);
}

// ═══════════════════════════════════════════════════════════════
// 树形结构
// ═══════════════════════════════════════════════════════════════

export async function getDocumentTree(
  documentId: string,
  structureOnly?: boolean,
): Promise<KBTreeIndex> {
  const query = structureOnly ? "?structure_only=true" : "";
  return apiGet<KBTreeIndex>(`/documents/${documentId}/tree${query}`);
}

// ═══════════════════════════════════════════════════════════════
// 查询
// ═══════════════════════════════════════════════════════════════

export function getDownloadUrl(documentId: string): string {
  return `${getBaseUrl()}/documents/${documentId}/download`;
}

export async function queryKnowledgeBase(req: QueryRequest): Promise<QueryResponse> {
  return apiPost<QueryResponse>("/query", req);
}

export async function queryKnowledgeBaseStream(
  req: QueryRequest,
  onEvent: (event: SSEEvent) => void,
  onError?: (error: Error) => void,
  onDone?: () => void,
): Promise<void> {
  const response = await authFetch(`${getBaseUrl()}/query/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });

  if (!response.ok) {
    const status = response.status;
    const error = await response.json().catch(() => ({ detail: `HTTP ${status}` }));
    throw new Error(`HTTP ${status}: ${error.detail}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Response body is not readable");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (trimmed.startsWith("data:")) {
          const data = trimmed.slice(5).trim();
          if (!data) continue;
          try {
            const parsed = JSON.parse(data) as SSEEvent;
            onEvent(parsed);
            if (parsed.type === "done") {
              onDone?.();
              return;
            }
            if (parsed.type === "error") {
              onError?.(new Error(parsed.message || "Unknown error"));
              return;
            }
          } catch {
            // Ignore unparseable SSE data
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  onDone?.();
}
