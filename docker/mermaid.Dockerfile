# Mermaid 持久渲染服务器
# 一次性启动 Chromium，所有请求复用同一浏览器实例

FROM node:22-slim

# 安装 Chrome 运行所需系统库（小包，apt 源能下）+ 下载工具
RUN apt-get update && apt-get install -y \
    unzip curl ca-certificates \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
    libdrm2 libdbus-1-3 libxkbcommon0 libxcomposite1 libxdamage1 \
    libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 libatspi2.0-0 libxshmfence1 \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# 从 GitHub 下载 Noto Sans CJK SC 中文字体
RUN curl -fSL --retry 3 --retry-delay 5 -o /tmp/NotoSansCJKsc.zip \
      https://github.com/notofonts/noto-cjk/releases/download/Sans2.004/08_NotoSansCJKsc.zip && \
    mkdir -p /usr/share/fonts/opentype/noto-sans-cjk && \
    unzip -j /tmp/NotoSansCJKsc.zip "*.otf" -d /usr/share/fonts/opentype/noto-sans-cjk && \
    rm /tmp/NotoSansCJKsc.zip

WORKDIR /app

# 跳过 puppeteer 内置 Chrome 下载（Google CDN 连不上）
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN npm install puppeteer mermaid@11

# 从 Chrome for Testing 官方存储下载 Chrome（storage.googleapis.com 可达）
RUN CHROME_VERSION=$(curl -sL "https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions.json" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).channels.Stable.version))") && \
    echo "Downloading Chrome $CHROME_VERSION ..." && \
    curl -fSL --retry 3 --retry-delay 5 -o /tmp/chrome-linux64.zip \
      "https://storage.googleapis.com/chrome-for-testing-public/${CHROME_VERSION}/linux64/chrome-linux64.zip" && \
    unzip /tmp/chrome-linux64.zip -d /opt/chrome && \
    rm /tmp/chrome-linux64.zip && \
    ls /opt/chrome/chrome-linux64/ && \
    ln -sf /opt/chrome/chrome-linux64/chrome /usr/bin/chromium && \
    echo "Chrome symlinked to /usr/bin/chromium"

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

COPY docker/mermaid-server.mjs .
EXPOSE 8080
CMD ["node", "mermaid-server.mjs"]
