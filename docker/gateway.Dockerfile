# Backend Dockerfile — multi-stage build
# Stage 1 (builder): compiles native Python extensions with build-essential
# Stage 2 (dev):     retains toolchain for dev containers (uv sync at startup)
# Stage 3 (runtime): clean image without compiler toolchain for production

# UV source image (override for restricted networks that cannot reach ghcr.io)
ARG UV_IMAGE=ghcr.io/astral-sh/uv:0.7.20
FROM ${UV_IMAGE} AS uv-source

# ── Stage 1: Builder ──────────────────────────────────────────────────────────
FROM python:3.12-slim-bookworm AS builder

ARG NODE_MAJOR=22
ARG APT_MIRROR
ARG UV_INDEX_URL
# Optional extras to install (e.g. "postgres" for PostgreSQL support)
# Usage: docker build --build-arg UV_EXTRAS=postgres ...
ARG UV_EXTRAS

# Optionally override apt mirror for restricted networks (e.g. APT_MIRROR=mirrors.aliyun.com)
RUN if [ -n "${APT_MIRROR}" ]; then \
      sed -i "s|deb.debian.org|${APT_MIRROR}|g" /etc/apt/sources.list.d/debian.sources 2>/dev/null || true; \
      sed -i "s|deb.debian.org|${APT_MIRROR}|g" /etc/apt/sources.list 2>/dev/null || true; \
    fi

# Install build tools + Node.js + 论文写作依赖的系统工具
# graphviz: 流程图生成
# fonts-noto-cjk: 中文字体支持
# libgl1-mesa-glx: opencv 依赖
# libglib2.0-0: 图像处理库依赖
RUN --mount=type=cache,target=/var/cache/apt \
    --mount=type=cache,target=/var/lib/apt/lists \
    apt-get update && apt-get install -y \
    curl \
    build-essential \
    gnupg \
    ca-certificates \
    graphviz \
    graphviz-dev \
    fonts-wqy-zenhei \
    libgl1-mesa-glx \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgomp1 \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" > /etc/apt/sources.list.d/nodesource.list \
    && apt-get update \
    && apt-get install -y nodejs

# Install uv (source image overridable via UV_IMAGE build arg)
COPY --from=uv-source /uv /uvx /usr/local/bin/

# Set working directory
WORKDIR /app

# Copy backend source code
COPY backend ./backend

# 虚拟环境建在 /opt/venv（不在项目目录内）
# 这样宿主机挂载 backend/ 不会冲掉它，无需 volume 兜底，无需启动时重 sync
ENV UV_PROJECT_ENVIRONMENT=/opt/venv
ENV PATH=/opt/venv/bin:$PATH

# Install dependencies with cache mount
# When UV_EXTRAS is set (e.g. "postgres"), installs optional dependencies.
RUN --mount=type=cache,target=/root/.cache/uv \
    sh -c "cd backend && UV_INDEX_URL=${UV_INDEX_URL:-https://pypi.org/simple} uv sync ${UV_EXTRAS:+--extra $UV_EXTRAS}"

# 安装论文写作相关 Python 依赖
# 这些包用于：文档生成、图表绘制、数据分析、PDF处理、图片生成等
# 注意：只装 skills 实际用到的包，功能重复的已去重
RUN cd /app/backend && uv pip install --no-cache-dir \
    # 文档处理 (Word/Excel/PDF)
    python-docx \
    docxtpl \
    openpyxl \
    pdfplumber \
    reportlab \
    # 图表与可视化
    matplotlib \
    seaborn \
    graphviz \
    pillow \
    wordcloud \
    # 数据分析与科学计算
    pandas \
    numpy \
    scipy \
    duckdb \
    # 网络请求
    requests \
    # HTML/Markdown 处理
    beautifulsoup4 \
    lxml \
    markdown \
    # 文本处理
    jieba \
    # 其他实用工具
    pyyaml \
    python-dotenv \
    tqdm \
    cairosvg \
    # Ollama 集成
    langchain-ollama \
    && rm -rf /root/.cache/pip

# UTF-8 locale prevents UnicodeEncodeError on Chinese/emoji content in minimal
# containers where locale configuration may be missing and the default encoding is not UTF-8.
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8
ENV PYTHONIOENCODING=utf-8

# ── Stage 2: Dev ──────────────────────────────────────────────────────────────
# Retains compiler toolchain from builder so hot-reload `uv run` works.
FROM builder AS dev

# Install Docker CLI (for DooD: allows starting sandbox containers via host Docker socket)
COPY --from=docker:cli /usr/local/bin/docker /usr/local/bin/docker

# Install Mermaid rendering dependencies (happy-dom + mermaid, no browser needed)
RUN mkdir -p /opt/mermaid-render && cd /opt/mermaid-render && \
    npm init -y --silent && \
    npm install mermaid@11 dompurify happy-dom --silent 2>&1 | tail -3 && \
    rm -rf /root/.npm /root/.cache

EXPOSE 8002 2024

CMD ["sh", "-c", "cd backend && PYTHONPATH=. uv run --no-sync uvicorn app.gateway.app:app --host 0.0.0.0 --port 8002 --workers 4"]

# ── Stage 3: Runtime ──────────────────────────────────────────────────────────
# Clean image without build-essential — reduces size (~200 MB) and attack surface.
FROM python:3.12-slim-bookworm

ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8
ENV PYTHONIOENCODING=utf-8

# Copy Node.js runtime from builder (provides npx for MCP servers)
COPY --from=builder /usr/bin/node /usr/bin/node
COPY --from=builder /usr/lib/node_modules /usr/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/bin/npm \
    && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/bin/npx

# Install Docker CLI (for DooD: allows starting sandbox containers via host Docker socket)
COPY --from=docker:cli /usr/local/bin/docker /usr/local/bin/docker

# 从 builder 阶段复制系统依赖（graphviz、字体等）
COPY --from=builder /usr/bin/dot /usr/bin/dot
COPY --from=builder /usr/lib/x86_64-linux-gnu/graphviz /usr/lib/x86_64-linux-gnu/graphviz
COPY --from=builder /usr/share/graphviz /usr/share/graphviz
COPY --from=builder /usr/share/fonts /usr/share/fonts
COPY --from=builder /etc/fonts /etc/fonts

# 安装 runtime 所需的系统库
RUN apt-get update && apt-get install -y \
    libgl1-mesa-glx \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgomp1 \
    && fc-cache -fv \
    && rm -rf /var/lib/apt/lists/*

# Install uv (source image overridable via UV_IMAGE build arg)
COPY --from=uv-source /uv /uvx /usr/local/bin/

# Set working directory
WORKDIR /app

# Copy backend with pre-built virtualenv from builder
COPY --from=builder /app/backend ./backend
# 复制虚拟环境（独立路径，不在项目内）
COPY --from=builder /opt/venv /opt/venv
ENV UV_PROJECT_ENVIRONMENT=/opt/venv
ENV PATH=/opt/venv/bin:$PATH

# Expose ports (gateway: 8002, langgraph: 2024)
EXPOSE 8002 2024

# Default command (can be overridden in docker-compose)
CMD ["sh", "-c", "cd backend && PYTHONPATH=. uv run --no-sync uvicorn app.gateway.app:app --host 0.0.0.0 --port 8002 --workers 4"]
