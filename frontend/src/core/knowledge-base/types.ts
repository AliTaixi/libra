/** 知识库类型定义 */

export interface KBCollection {
  id: string;
  user_id?: string;
  name: string;
  description: string;
  metadata_schema?: Record<string, unknown>;
  document_count?: number;
  created_at: string;
  updated_at: string;
}

export interface KBDocument {
  id: string;
  collection_id: string;
  user_id?: string;
  title: string;
  doc_type?: string;
  doc_format?: string;
  custom_fields?: Record<string, unknown>;
  file_path?: string;
  file_size?: number;
  original_filename?: string;
  page_count?: number;
  line_count?: number;
  token_count?: number;
  status: string;          // pending | indexing | ready | failed
  error_message?: string;
  doc_description?: string;
  created_at: string;
  updated_at: string;
}

export interface KBTreeIndex {
  doc_name?: string;
  doc_description?: string;
  line_count?: number;
  structure: KBTreeNode[];
}

/** Recursive tree node — matches PageIndex JSON structure */
export interface KBTreeNode {
  title: string;
  node_id: string;
  line_num?: number;
  summary?: string;
  prefix_summary?: string;
  text?: string;
  /** child nodes (PageIndex uses "nodes" key, same as "children") */
  nodes?: KBTreeNode[];
}

export interface QueryRequest {
  collection_id: string;
  query: string;
  doc_ids?: string[];
  top_k?: number;
  model_name?: string;
}

export interface QuerySource {
  doc_id: string;
  doc_name: string;
  doc_description?: string;
}

export interface QueryResponse {
  answer: string;
  sources: QuerySource[];
  candidate_count: number;
}

export interface SSEEvent {
  type: "routing" | "search" | "context" | "token" | "done" | "error";
  text?: string;
  documents?: Array<{ doc_id: string; doc_name: string }>;
  doc_id?: string;
  doc_name?: string;
  nodes?: string[];
  content?: string;
  sources?: QuerySource[];
  message?: string;
}

export interface CreateCollectionRequest {
  name: string;
  description?: string;
  metadata_schema?: Record<string, unknown>;
}

export interface UpdateCollectionRequest {
  name?: string;
  description?: string;
  metadata_schema?: Record<string, unknown>;
}

export interface CreateDocumentRequest {
  title: string;
  doc_type?: string;
  metadata?: Record<string, unknown>;
  original_filename?: string;
  model_name?: string;
}

export interface UpdateDocumentRequest {
  title?: string;
  status?: string;
  metadata?: Record<string, unknown>;
}

export interface UploadContentRequest {
  content: string;
  filename?: string;
  model_name?: string;
}

export interface IndexDocumentResponse {
  success: boolean;
  doc_id?: string;
  node_count?: number;
  depth?: number;
  line_count?: number;
  token_count?: number;
  doc_description?: string;
  error?: string;
}
