/**
 * useWhisperRecorder — React hook for audio recording + Whisper transcription.
 *
 * Manages the full lifecycle:
 *   1. Request mic permission
 *   2. MediaRecorder recording
 *   3. Send blob to Whisper ASR endpoint
 *   4. Return transcribed text
 *
 * Usage:
 *   const { isRecording, isTranscribing, startRecording, stopRecording, transcribe, error } = useWhisperRecorder();
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { transcribeAudio, type TranscriptionResult } from "@/core/audio/api";

export type RecordingStatus =
  | "idle"
  | "requesting_mic"   // 正在请求麦克风权限
  | "recording"         // 正在录音
  | "transcribing"      // 正在转写
  | "error";            // 出错

export type WhisperRecorderOptions = {
  /** MediaRecorder mime type. Falls back to browser default if unsupported. */
  mimeType?: string;
  /** Filename hint sent to the server. */
  filename?: string;
};

export type WhisperRecorderResult = {
  status: RecordingStatus;
  isRecording: boolean;
  isTranscribing: boolean;
  error: string | null;
  /** Start recording. Must be called from a user gesture (click). */
  startRecording: () => Promise<void>;
  /** Stop recording and return the audio blob. */
  stopRecording: () => Promise<Blob | null>;
  /** Shortcut: stop + transcribe in one call. */
  stopAndTranscribe: () => Promise<TranscriptionResult | null>;
  /** Discard the current recording without processing. */
  cancelRecording: () => void;
};

const RECORDING_TIMEOUT_MS = 5 * 60 * 1000; // 5 分钟自动停止

/**
 * Try to find the best supported mime type for audio recording.
 */
function getSupportedMimeType(): string {
  const types = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
    "",
  ];
  for (const type of types) {
    if (!type || MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return "";
}

export function useWhisperRecorder(
  options?: WhisperRecorderOptions,
): WhisperRecorderResult {
  const [status, setStatus] = useState<RecordingStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resolveRef = useRef<((blob: Blob | null) => void) | null>(null);

  const cleanup = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (mediaRecorderRef.current?.state !== "inactive") {
      try {
        mediaRecorderRef.current?.stop();
      } catch {
        // ignore
      }
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    mediaRecorderRef.current = null;
    chunksRef.current = [];
  }, []);

  const startRecording = useCallback(async () => {
    setError(null);
    setStatus("requesting_mic");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = options?.mimeType || getSupportedMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onerror = () => {
        setError("录音失败");
        setStatus("error");
        cleanup();
      };

      recorder.onstop = () => {
        // 如果有 pending 的 resolve，用当前 chunks 构建 blob
        if (resolveRef.current) {
          const blob = chunksRef.current.length > 0
            ? new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" })
            : null;
          resolveRef.current(blob);
          resolveRef.current = null;
        }
      };

      recorder.start();

      // 自动停止超时
      timeoutRef.current = setTimeout(() => {
        if (mediaRecorderRef.current?.state === "recording") {
          mediaRecorderRef.current.stop();
        }
      }, RECORDING_TIMEOUT_MS);

      setStatus("recording");
    } catch (err) {
      const msg =
        (err as DOMException).name === "NotAllowedError"
          ? "麦克风权限被拒绝"
          : (err as DOMException).name === "NotFoundError"
            ? "未检测到麦克风"
            : `无法启动录音: ${(err as Error).message}`;
      setError(msg);
      setStatus("error");
      cleanup();
    }
  }, [options?.mimeType, cleanup]);

  const stopRecording = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      if (!mediaRecorderRef.current || mediaRecorderRef.current.state === "inactive") {
        resolve(null);
        return;
      }

      resolveRef.current = resolve;
      mediaRecorderRef.current.stop();

      // 清理 stream
      if (streamRef.current) {
        for (const track of streamRef.current.getTracks()) {
          track.stop();
        }
        streamRef.current = null;
      }

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      setStatus("idle");
    });
  }, []);

  const stopAndTranscribe = useCallback(async (): Promise<TranscriptionResult | null> => {
    const blob = await stopRecording();
    if (!blob) return null;

    setStatus("transcribing");
    try {
      const result = await transcribeAudio(blob, options?.filename);
      setStatus("idle");
      return result;
    } catch (err) {
      const message = (err as Error).message || "转写失败";
      setError(message);
      setStatus("error");
      return null;
    }
  }, [stopRecording, options?.filename]);

  const cancelRecording = useCallback(() => {
    cleanup();
    chunksRef.current = [];
    resolveRef.current = null;
    setStatus("idle");
  }, [cleanup]);

  // 组件卸载时清理录音资源
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return {
    status,
    isRecording: status === "recording",
    isTranscribing: status === "transcribing",
    error,
    startRecording,
    stopRecording,
    stopAndTranscribe,
    cancelRecording,
  };
}
