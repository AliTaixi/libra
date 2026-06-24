#!/bin/bash
set -euo pipefail
OUTPUT="/mnt/user-data/输出.docx"
while [[ $# -gt 0 ]]; do
  case "$1" in --input) INPUT="$2"; shift 2 ;; --output) OUTPUT="$2"; shift 2 ;; *) echo "未知参数: $1"; exit 1 ;; esac
done
if [ -z "$INPUT" ]; then echo "错误：缺少 --input 参数"; exit 1; fi
if [ ! -f "$INPUT" ]; then echo "错误：文件不存在: $INPUT"; exit 1; fi
mkdir -p "$(dirname "$OUTPUT")"

# Auto-install Python deps (non-blocking, best-effort)
python3 -c "import docx" 2>/dev/null || {
  echo "正在安装 python-docx..."
  pip3 install python-docx -q 2>/dev/null || pip install python-docx -q 2>/dev/null || true
}
python3 -c "import cairosvg" 2>/dev/null || {
  echo "正在安装 cairosvg..."
  pip3 install cairosvg -q 2>/dev/null || pip install cairosvg -q 2>/dev/null || true
}

# Try to install rsvg-convert (with timeout — apt can hang in sandbox)
if ! which rsvg-convert 2>/dev/null; then
  echo "正在安装 rsvg-convert（超时 30 秒）..."
  timeout 30 sh -c '
    apt-get update -qq 2>/dev/null
    apt-get install -y -qq librsvg2-bin 2>/dev/null
  ' && echo "rsvg-convert 安装成功" || echo "rsvg-convert 安装跳过（不影响转换，Python 脚本会尝试其他渲染器）"
fi

TMP=$(mktemp -d)
cp "$(dirname "$0")/convert_md_to_docx.py" "$TMP/"
cd "$TMP"
python3 convert_md_to_docx.py --input "$INPUT" --output "$OUTPUT"
rm -rf "$TMP"
echo "文档已生成: $OUTPUT"
