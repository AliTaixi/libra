"""Gateway router for audio transcription via Whisper ASR server.

Forward audio files from the frontend to the dedicated whisper-server
container (faster-whisper large-v3) and return transcription results.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
from httpx import AsyncClient, Timeout

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/audio", tags=["audio"])

# ── Configuration ──────────────────────────────────────────────────────────
# whisper-server 容器在 Docker 内部网络中的地址
# Docker Compose 网络内直接用容器名访问
WHISPER_SERVER_URL = os.getenv(
    "WHISPER_SERVER_URL",
    "http://whisper-server:10300",
)

# 最大 50MB (与 uploads 保持一致)
MAX_FILE_SIZE = 50 * 1024 * 1024

# 支持的音频格式
ALLOWED_EXTENSIONS = {
    ".wav", ".mp3", ".flac", ".ogg", ".m4a",
    ".webm", ".aac", ".wma", ".opus", ".amr",
}

# 转写超时：较大音频文件可能需要较长时间
TRANSCRIBE_TIMEOUT = 300  # 5 分钟


def _validate_audio(filename: str) -> None:
    """Reject unsupported audio formats."""
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        supported = ", ".join(sorted(ALLOWED_EXTENSIONS))
        raise HTTPException(
            status_code=400,
            detail=f"不支持的音频格式 '{ext}'。支持的格式：{supported}",
        )


@router.post("/transcribe")
async def transcribe_audio(audio: UploadFile = File(...)) -> dict:
    """Transcribe an audio file using the Whisper ASR server.

    接收前端上传的音频文件，转发给 whisper-server 进行转写，
    返回转写文本和元数据。
    """
    # 校验文件格式
    if audio.filename:
        _validate_audio(audio.filename)

    # 读取音频内容
    content = await audio.read()
    if len(content) == 0:
        raise HTTPException(status_code=400, detail="音频文件为空")
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="音频文件过大（最大 50MB）")

    # 构造文件名供 whisper-server 判断格式
    filename = audio.filename or "audio.wav"

    try:
        async with AsyncClient(timeout=Timeout(TRANSCRIBE_TIMEOUT)) as client:
            resp = await client.post(
                f"{WHISPER_SERVER_URL}/transcribe",
                files={"audio": (filename, content, audio.content_type or "audio/wav")},
            )

        if resp.status_code != 200:
            logger.error(
                "Whisper server error: %d %s",
                resp.status_code, resp.text,
            )
            raise HTTPException(
                status_code=resp.status_code,
                detail=f"语音转写服务错误: {resp.text}",
            )

        result = resp.json()
        logger.info(
            "Transcription successful: language=%s, duration=%.1fs",
            result.get("language", "?"),
            result.get("duration", 0),
        )
        return result

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Failed to forward audio to whisper-server: %s", exc, exc_info=True)
        raise HTTPException(
            status_code=503,
            detail=f"语音转写服务不可用: {str(exc)}",
        )


@router.get("/health")
async def health_check() -> dict:
    """Check if the Whisper ASR server is healthy."""
    try:
        async with AsyncClient(timeout=Timeout(5)) as client:
            resp = await client.get(f"{WHISPER_SERVER_URL}/health")
        if resp.status_code == 200:
            return {"status": "ok", "whisper_server": resp.json()}
        else:
            return {"status": "error", "detail": resp.text}
    except Exception as exc:
        return {"status": "error", "detail": str(exc)}
