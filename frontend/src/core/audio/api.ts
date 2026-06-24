/**
 * Audio transcription API client.
 *
 * Records audio on the client, sends it to the Gateway's Whisper ASR endpoint,
 * and returns the transcribed text.
 */

import { fetch } from "@/core/api/fetcher";
import { getBackendBaseURL } from "@/core/config";

export type TranscriptionResult = {
  text: string;
  language: string;
  language_probability: number;
  duration: number;
};

export type TranscriptionError = {
  code: "NO_AUDIO" | "TOO_LARGE" | "SERVER_ERROR" | "NETWORK_ERROR";
  message: string;
};

/**
 * Transcribe an audio blob via the Gateway's Whisper ASR endpoint.
 *
 * @param blob - Recorded audio blob (WebM/Opus, WAV, etc.)
 * @param filename - Optional filename hint for the server
 * @returns The transcribed text and metadata
 */
export async function transcribeAudio(
  blob: Blob,
  filename = "recording.webm",
): Promise<TranscriptionResult> {
  if (blob.size === 0) {
    throw Object.assign(new Error("No audio recorded"), {
      code: "NO_AUDIO",
    } satisfies TranscriptionError);
  }

  const MAX_SIZE = 50 * 1024 * 1024; // 50MB
  if (blob.size > MAX_SIZE) {
    throw Object.assign(new Error("Audio recording too large (max 50MB)"), {
      code: "TOO_LARGE",
    } satisfies TranscriptionError);
  }

  const formData = new FormData();
  formData.append("audio", blob, filename);

  try {
    const baseUrl = getBackendBaseURL();
    const response = await fetch(`${baseUrl}/api/audio/transcribe`, {
      method: "POST",
      body: formData,
      // Let the browser set Content-Type with boundary for multipart
    });

    if (!response.ok) {
      const detail = await response.text();
      throw Object.assign(
        new Error(`Transcription failed: ${response.status} ${detail}`),
        { code: "SERVER_ERROR" },
      );
    }

    return (await response.json()) as TranscriptionResult;
  } catch (err) {
    if ((err as TranscriptionError).code) {
      throw err;
    }
    throw Object.assign(
      new Error(
        `Network error: ${(err as Error).message}`,
      ),
      { code: "NETWORK_ERROR" },
    );
  }
}
