/**
 * API functions for per-user shared file management.
 * User-data is now shared across all threads and flat (no subdirectories).
 */

import { fetch } from "../api/fetcher";
import { getBackendBaseURL } from "../config";

export interface UserFileInfo {
  filename: string;
  size: number | string;
  path: string;
  download_url?: string;
  virtual_path?: string;
  artifact_url?: string;
  extension?: string;
  modified?: number;
}

export interface ListUserFilesResponse {
  files: UserFileInfo[];
  count: number;
}

/**
 * List all files in the current user's shared user-data directory.
 */
export async function listUserFiles(): Promise<ListUserFilesResponse> {
  const response = await fetch(
    `${getBackendBaseURL()}/api/user/files`,
  );

  if (!response.ok) {
    throw new Error(
      await readErrorDetail(response, "Failed to list user files"),
    );
  }

  return response.json();
}

/**
 * Delete a file from the current user's shared user-data directory.
 */
export async function deleteUserFile(
  filename: string,
): Promise<{ success: boolean; message: string }> {
  const response = await fetch(
    `${getBackendBaseURL()}/api/user/files/${encodeURIComponent(filename)}`,
    {
      method: "DELETE",
    },
  );

  if (!response.ok) {
    throw new Error(await readErrorDetail(response, "Failed to delete file"));
  }

  return response.json();
}

async function readErrorDetail(
  response: Response,
  fallback: string,
): Promise<string> {
  const error = await response.json().catch(() => ({ detail: fallback }));
  return error.detail ?? fallback;
}
