#!/bin/bash
# Word 转 Markdown 转换脚本
# 用法: bash convert.sh <输入.docx> [输出.md]

set -euo pipefail
SCRIPT_DIR="$(dirname "$0")"
INPUT="${1:?错误：请指定输入 .docx 文件路径}"

if [ -n "${2:-}" ]; then
    OUTPUT="$2"
else
    OUTPUT="${INPUT%.docx}.md"
fi

# 确保输出目录存在
mkdir -p "$(dirname "$OUTPUT")"

# 调用 Python 转换脚本
python3 "$SCRIPT_DIR/docx_to_md.py" "$INPUT" "$OUTPUT" && echo "转换成功: $OUTPUT" || {
    echo "错误：转换失败" >&2
    exit 1
}
