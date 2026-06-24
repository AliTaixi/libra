#!/bin/sh
# python3 wrapper — 禁止内联执行 Python 代码，只允许运行 .py 文件
# 防止 AI 写 python -c "..." 或 pip install

BASE=$(basename "$0")

if [ "$BASE" = "pip" ] || [ "$BASE" = "pip3" ]; then
    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║  pip 已被禁用                                              ║"
    echo "║  所有 Python 包已在 Docker 构建时预装                       ║"
    echo "║  如需新增依赖，请修改 backend/Dockerfile 并重建镜像        ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""
    exit 1
fi

# 检查是否在运行内联代码 (-c 参数)
for arg in "$@"; do
    if [ "$arg" = "-c" ]; then
        echo ""
        echo "╔══════════════════════════════════════════════════════════════╗"
        echo "║  内联 Python 代码执行已被禁止                              ║"
        echo "║  请使用 /mnt/skills/public/ 下已有的脚本                    ║"
        echo "║  或在 /mnt/skills/public/<skill>/scripts/ 中创建脚本文件  ║"
        echo "╚══════════════════════════════════════════════════════════════╝"
        echo ""
        exit 1
    fi
done

# 正常执行 python3
exec /usr/local/bin/python3.12 "$@"
