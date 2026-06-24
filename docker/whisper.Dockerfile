# ─────────────────────────────────────────────────────────────
# DeerFlow Whisper Server — 自构建镜像（不依赖 llm-base）
# faster-whisper (CTranslate2) — GPU accelerated ASR
# ─────────────────────────────────────────────────────────────
# 构建:
#   docker build -t libra-whisper -f docker/whisper.Dockerfile .
# 运行:
#   docker run --gpus all -p 10300:10300 -v whisper-models:/root/.cache/faster_whisper libra-whisper
# ─────────────────────────────────────────────────────────────

FROM python:3.12-slim

LABEL maintainer="DeerFlow Team"
LABEL description="faster-whisper large-v3 ASR server"

# 避免 tzdata 交互式配置
ENV DEBIAN_FRONTEND=noninteractive
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8

# 安装 ffmpeg（音频解码必需）
RUN apt-get update -y && apt-get install -y \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# faster-whisper 会自动拉 ctranslate2；额外安装 CUDA 12.x cuBLAS
#（CTranslate2 需要 libcublas.so.12，python:3.12-slim 自带不含 CUDA 库）
RUN pip3 install --no-cache-dir \
    faster-whisper>=1.1.0 \
    fastapi>=0.115.0 \
    uvicorn[standard]>=0.34.0 \
    python-multipart>=0.0.27 \
    nvidia-cublas-cu12>=12.0.0

# CUDA 库路径（nvidia-cublas-cu12 pip 包的 lib 目录）
ENV LD_LIBRARY_PATH=/usr/local/lib/python3.12/site-packages/nvidia/cublas/lib:$LD_LIBRARY_PATH

# 拷贝服务代码
COPY docker/whisper_app.py ./app.py

# ── 运行时配置 ──────────────────────────────────────────────
ENV WHISPER_MODEL=large-v3
ENV WHISPER_DEVICE=cuda
ENV WHISPER_COMPUTE_TYPE=float16
ENV WHISPER_BEAM=5
ENV WHISPER_LANG=zh
ENV WHISPER_SERVER_HOST=0.0.0.0
ENV WHISPER_SERVER_PORT=10300

EXPOSE 10300

CMD ["sh", "-c", "uvicorn app:app --host ${WHISPER_SERVER_HOST} --port ${WHISPER_SERVER_PORT} --workers 1"]
