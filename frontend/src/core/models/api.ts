import { getBackendBaseURL } from "../config";

import type { ModelCreateRequest, ModelUpdateRequest, ModelsResponse } from "./types";

async function csrfFetch(input: string, init?: RequestInit): Promise<Response> {
  const { fetch: authFetch } = await import("../api/fetcher");
  return authFetch(input, init);
}

export async function loadModels(): Promise<ModelsResponse> {
  const res = await fetch(`${getBackendBaseURL()}/api/models`);
  const data = (await res.json()) as Partial<ModelsResponse>;
  return {
    models: data.models ?? [],
    token_usage: data.token_usage ?? { enabled: false },
  };
}

export async function createModel(body: ModelCreateRequest): Promise<void> {
  const res = await csrfFetch(`${getBackendBaseURL()}/api/models`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Failed to create model" }));
    throw new Error(err.detail || "Failed to create model");
  }
}

export async function updateModel(name: string, body: ModelUpdateRequest): Promise<void> {
  const res = await csrfFetch(`${getBackendBaseURL()}/api/models/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Failed to update model" }));
    throw new Error(err.detail || "Failed to update model");
  }
}

export async function deleteModel(name: string): Promise<void> {
  const res = await csrfFetch(`${getBackendBaseURL()}/api/models/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Failed to delete model" }));
    throw new Error(err.detail || "Failed to delete model");
  }
}
