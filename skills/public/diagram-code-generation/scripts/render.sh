#!/bin/bash
set -euo pipefail
INPUT="$1"
OUTPUT="$2"
MODE="${3:-svg}"

MERMAID_SERVER="${MERMAID_SERVER_URL:-http://mermaid-server:8080}"

if [ "$MODE" = "png" ]; then
  curl -sf -X POST --data-binary @"$INPUT" \
    -H "X-Format: png" \
    "$MERMAID_SERVER/render" > "$OUTPUT" && echo "渲染成功: $OUTPUT" || {
    echo "错误：PNG 渲染失败" >&2; exit 1
  }
else
  curl -sf -X POST --data-binary @"$INPUT" \
    "$MERMAID_SERVER/render" > "$OUTPUT" && echo "渲染成功: $OUTPUT" || {
    echo "错误：SVG 渲染失败" >&2; exit 1
  }
fi
