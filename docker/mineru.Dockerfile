# ─────────────────────────────────────────────────────────────
# MinerU 文档解析服务 — 自构建镜像
# 文档解析（OCR、版面分析、表格还原、图片提取）
# ─────────────────────────────────────────────────────────────
# 构建:
#   docker build -t mineru:latest -f docker/mineru.Dockerfile .
# 运行由 docker-compose 管理，无需手动执行
# ─────────────────────────────────────────────────────────────

FROM python:3.12-slim-bookworm

LABEL maintainer="Libra Team"
LABEL description="MinerU document parsing service"

# 避免 tzdata 交互式配置
ENV DEBIAN_FRONTEND=noninteractive
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8

# 安装系统依赖
#   libgl1 / libglib2.0-0 — OpenCV 依赖
RUN apt-get update && \
    apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# 安装 MinerU 核心包
RUN python3 -m pip install -U 'mineru[core]>=3.2.1' && \
    python3 -m pip cache purge

# 下载 MinerU 模型文件（OCR、版面分析等）
RUN mineru-models-download -s huggingface -m pipeline

ENTRYPOINT []
CMD ["mineru-api", "--host", "0.0.0.0", "--port", "8000"]
