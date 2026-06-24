"""DeerFlow Whisper Server — faster-whisper ASR service.

Provides a REST API for speech-to-text transcription using
faster-whisper (CTranslate2 backend), optimized for GPU inference.

Endpoints:
  POST /transcribe  — Transcribe an audio file, returns JSON with text
  GET  /health      — Health check
"""

import logging
import os
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from faster_whisper import WhisperModel

# ── Logging ────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("whisper-server")

# ── Configuration ──────────────────────────────────────────────────────────
MODEL_NAME = os.getenv("WHISPER_MODEL", "large-v3")
DEVICE = os.getenv("WHISPER_DEVICE", "cuda")
COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "float16")
BEAM_SIZE = int(os.getenv("WHISPER_BEAM", "5"))
LANG = os.getenv("WHISPER_LANG", "zh")  # None = auto-detect

# 支持的音频格式白名单
ALLOWED_EXTENSIONS = {
    ".wav", ".mp3", ".flac", ".ogg", ".m4a",
    ".webm", ".aac", ".wma", ".opus", ".amr",
}

# 最大文件大小：50MB
MAX_FILE_SIZE = 50 * 1024 * 1024

# ── Model (lazy-loaded at startup via lifespan) ────────────────────────────
model: WhisperModel | None = None


def _load_model() -> WhisperModel:
    """Initialize the faster-whisper model.

    Downloads the model from HuggingFace Hub on first call if not cached.
    Cache is persisted in ~/.cache/faster_whisper (mountable as a Docker volume
    so it survives container recreations).
    """
    logger.info(
        "Loading model %s on %s (compute_type=%s) ...",
        MODEL_NAME, DEVICE, COMPUTE_TYPE,
    )
    m = WhisperModel(
        MODEL_NAME,
        device=DEVICE,
        compute_type=COMPUTE_TYPE,
        # download_root 可自定义，默认 ~/.cache/faster_whisper
    )
    logger.info("Model %s loaded successfully", MODEL_NAME)
    return m


def _validate_audio(filename: str) -> None:
    """Reject unsupported audio formats."""
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        supported = ", ".join(sorted(ALLOWED_EXTENSIONS))
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported audio format '{ext}'. Supported: {supported}",
        )


# ── Application ────────────────────────────────────────────────────────────
app = FastAPI(
    title="DeerFlow Whisper Server",
    description="faster-whisper large-v3 speech-to-text service",
    version="0.1.0",
)


@app.on_event("startup")
async def startup() -> None:
    """Pre-load the model on startup so the first request isn't slow."""
    global model
    model = _load_model()


@app.on_event("shutdown")
async def shutdown() -> None:
    """Clean shutdown."""
    global model
    if model is not None:
        logger.info("Shutting down Whisper model")
        model = None


@app.get("/health")
async def health() -> dict:
    """Health check endpoint."""
    return {
        "status": "healthy",
        "model": MODEL_NAME,
        "device": DEVICE,
        "compute_type": COMPUTE_TYPE,
    }


@app.post("/transcribe")
async def transcribe(audio: UploadFile = File(...)) -> dict:
    """Transcribe an uploaded audio file to text.

    Accepts common audio formats (WAV, MP3, FLAC, OGG, M4A, etc.).
    Returns the transcription text with metadata.
    """
    if model is None:
        raise HTTPException(status_code=503, detail="Model not loaded")

    # 校验文件名校验格式
    if audio.filename:
        _validate_audio(audio.filename)

    # 读取上传内容
    content = await audio.read()
    if len(content) == 0:
        raise HTTPException(status_code=400, detail="Empty audio file")
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="Audio file too large (max 50MB)")

    # 写入临时文件（faster-whisper 需要文件路径，不支持 bytes 直接输入）
    suffix = Path(audio.filename or "audio.wav").suffix or ".wav"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        logger.info(
            "Transcribing %s (%.1f MB) ...",
            audio.filename or "unknown", len(content) / 1024 / 1024,
        )

        kwargs = {"beam_size": BEAM_SIZE}
        if LANG:
            kwargs["language"] = LANG

        segments, info = model.transcribe(tmp_path, **kwargs)
        # 将生成器兑现为列表以获取完整结果
        segments_list = list(segments)

        text = "".join(seg.text for seg in segments_list)

        logger.info(
            "Transcription complete: language=%s (prob=%.2f), duration=%.1fs, segments=%d",
            info.language, info.language_probability,
            info.duration, len(segments_list),
        )

        return {
            "text": text.strip(),
            "language": info.language,
            "language_probability": info.language_probability,
            "duration": info.duration,
            "segments": [
                {
                    "start": round(seg.start, 2),
                    "end": round(seg.end, 2),
                    "text": seg.text.strip(),
                }
                for seg in segments_list
            ],
        }

    except Exception as exc:
        logger.error("Transcription failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(exc)}")

    finally:
        # 清理临时文件
        try:
            os.unlink(tmp_path)
        except Exception:
            pass
