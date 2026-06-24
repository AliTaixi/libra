#!/usr/bin/env node
/**
 * Persistent Mermaid render server.
 *
 * 一次性启动 Chromium，所有渲染请求复用同一个浏览器实例，
 * 彻底消除每个请求启动 Chromium 的开销。
 *
 * API:
 *   POST /render          Mermaid 代码在请求体中，返回 SVG
 *   POST /render          X-Format: png 头部，返回 PNG
 *   GET  /health          健康检查
 *
 * 用法:
 *   node mermaid-server.mjs
 *
 * 构建:
 *   基于 libra-mermaid 镜像（已有 node:22-slim + chromium + puppeteer）
 *   或作为独立服务运行。
 */

import http from "http";
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { launch } from "puppeteer";

const PORT = 8080;
const CHROMIUM_PATH = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
const require = createRequire(import.meta.url);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. 启动 Chromium（一次性）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const browser = await launch({
  executablePath: CHROMIUM_PATH,
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-background-networking",
    "--disable-sync",
    "--disable-translate",
    "--disable-default-apps",
    "--no-first-run",
  ],
});

const page = await browser.newPage();
page.on("console", (m) => {
  if (m.type() === "error") console.error("[browser]", m.text());
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. 准备 Mermaid 渲染页面
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const MERMAID_SRC = fs.readFileSync(
  require.resolve("mermaid/dist/mermaid.min.js"),
  "utf-8",
);

// 主题配置：黑白透明
const THEME_VARS = {
  background: "transparent",
  primaryColor: "transparent",
  primaryBorderColor: "#000000",
  primaryTextColor: "#000000",
  secondaryColor: "transparent",
  secondaryBorderColor: "#000000",
  secondaryTextColor: "#000000",
  lineColor: "#000000",
  edgeLabelBackground: "transparent",
  nodeBorder: "#000000",
  mainBkg: "transparent",
  nodeTextColor: "#000000",
  clusterBkg: "transparent",
  clusterBorder: "#000000",
  clusterTextColor: "#000000",
  titleColor: "#000000",
};

// 渲染页面 HTML（mermaid 源码内联，无需 import）
const RENDER_HTML = `<!DOCTYPE html>
<html><body>
<div id="root"></div>
<script>
${MERMAID_SRC}
<\/script>
<script>
mermaid.initialize({
  startOnLoad: false,
  theme: "base",
  securityLevel: "loose",
  htmlLabels: false,
  maxTextSize: 100000,
  fontFamily: '"Noto Sans CJK SC", sans-serif',
  themeVariables: ${JSON.stringify(THEME_VARS)},
  flowchart: { useMaxWidth: true, htmlLabels: false, curve: "basis", padding: 16 },
});
window.renderMermaid = async (code) => {
  const { svg } = await mermaid.render("x", code);
  return svg;
};
<\/script>
</body></html>`;

// 导航到渲染页（一次性，使用 setContent 避免 file:// CORS 限制）
console.error("正在启动 Chromium 并加载 Mermaid...");
await page.setContent(RENDER_HTML, { waitUntil: "load" });
console.error("Mermaid 服务器就绪");

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3. 样式内联工具（等价于 inline-svg-styles.js）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function inject(el, attr, val) {
  if (new RegExp("\\b" + attr + "=").test(el)) return el;
  return el.replace(/(\s*\/?\s*>)/, ` ${attr}="${val}"$1`);
}

function inlineStyles(svg) {
  // 连线
  svg = svg.replace(/<g class="edgePaths">[\s\S]*?<\/g>/g, (block) =>
    block.replace(/<path\s[^>]*\/?>/g, (p) =>
      inject(inject(p, "stroke", "black"), "stroke-width", "1"),
    ),
  );
  // 箭头
  svg = svg.replace(/<marker[\s\S]*?<\/marker>/g, (block) =>
    block.replace(/<path\s[^>]*\/?>/g, (p) =>
      inject(
        inject(inject(p, "stroke", "black"), "fill", "black"),
        "stroke-width",
        "1",
      ),
    ),
  );
  // 节点框
  svg = svg.replace(
    /<g[^>]*class="[^"]*\bnode\b[^"]*"[^>]*>[\s\S]*?<\/g>/g,
    (group) =>
      group.replace(/<(rect|circle|ellipse|polygon|path)\s[^>]*\/?>/g, (el) =>
        inject(inject(inject(el, "fill", "transparent"), "stroke", "#000000"), "stroke-width", "1"),
      ),
  );
  // 分组框
  svg = svg.replace(
    /<g[^>]*class="[^"]*\bcluster\b[^"]*"[^>]*>[\s\S]*?<\/g>/g,
    (group) =>
      group.replace(/<rect\s[^>]*\/?>/g, (el) =>
        inject(inject(el, "fill", "transparent"), "stroke", "#000000"),
      ),
  );
  // SVG text：仅统一文字颜色为黑色，保留 Mermaid 原有的字号和对齐方式
  // （不注入 font-size/text-anchor/x，避免破坏架构图等复杂图类型的文字布局）
  svg = svg.replace(/<text\s[^>]*\/?>/g, (t) =>
    inject(t, "fill", "#000000"),
  );
  return svg;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 4. HTTP 服务
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const server = http.createServer(async (req, res) => {
  if (req.url === "/health" && req.method === "GET") {
    res.writeHead(200);
    res.end("OK");
    return;
  }

  if (req.url === "/render" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        const format = req.headers["x-format"] || "svg";

        // 在已加载 Mermaid 的页面中渲染
        const svg = await page.evaluate(async (code) => {
          return await window.renderMermaid(code);
        }, body);

        if (format === "png") {
          // PNG：插入 SVG，调整视口后全页截图（清晰 + 完整）
          const dimInfo = await page.evaluate(async (svgContent) => {
            const container = document.getElementById("root");
            container.innerHTML = svgContent;
            await new Promise((r) => setTimeout(r, 200));
            const svgEl = container.querySelector("svg");
            if (!svgEl) throw new Error("No SVG element in rendered output");
            // 取 viewBox 真实尺寸（比 getBoundingClientRect 更准）
            let w = 0, h = 0;
            const vb = svgEl.getAttribute("viewBox");
            if (vb) {
              const p = vb.trim().split(/\s+/).map(Number);
              if (p.length === 4) { w = p[2]; h = p[3]; }
            }
            if (!w || !h) {
              const b = svgEl.getBoundingClientRect();
              w = b.width; h = b.height;
            }
            return { width: Math.ceil(w) + 40, height: Math.ceil(h) + 40 };
          }, svg);
          // 设置 2x 视口保清晰，尺寸匹配 SVG
          await page.setViewport({
            width: Math.min(dimInfo.width, 4000),
            height: Math.min(dimInfo.height, 4000),
            deviceScaleFactor: 2,
          });
          // 等待重排
          await new Promise((r) => setTimeout(r, 100));
          const pngBuf = await page.screenshot({
            type: "png",
            fullPage: true,
            captureBeyondViewport: true,
            omitBackground: true,
          });
          res.writeHead(200, { "Content-Type": "image/png" });
          res.end(pngBuf);
        } else {
          // SVG：内联样式后返回
          const styled = inlineStyles(svg);
          res.writeHead(200, { "Content-Type": "image/svg+xml" });
          res.end(styled);
        }
      } catch (e) {
        console.error("渲染错误:", e.message);
        res.writeHead(500);
        res.end(e.message);
      }
    });
    return;
  }

  res.writeHead(404);
  res.end("Not Found");
});

server.listen(PORT, () => {
  console.error(`Mermaid server listening on port ${PORT}`);
});

// 优雅关闭
process.on("SIGTERM", async () => {
  await browser.close();
  server.close();
  process.exit(0);
});
