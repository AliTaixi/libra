#!/usr/bin/env python3
"""统一图表生成脚本，支持 Matplotlib / Seaborn 后端，输出 PNG。

用法：
  python generate.py --tool 1 --type bar --data "值:10|20|30" --x "A|B|C" --output chart.png

依赖（沙箱预装）：matplotlib, seaborn, numpy
"""

import argparse
import os
import re
import sys
from pathlib import Path

# ── 字体设置 ────────────────────────────────────────────────────────────────
# 沙箱预装 wqy-zenhei 中文字体
_CN_FONT = "WenQuanYi Zen Hei"
try:
    import matplotlib
    matplotlib.rcParams["font.family"] = _CN_FONT
    matplotlib.rcParams["axes.unicode_minus"] = False
    # 强制刷新字体缓存，确保中文字体生效
    matplotlib.font_manager._load_fontmanager(try_read_cache=False)
except Exception:
    pass

# ── 全局黑白透明风格（强制，不依赖 AI prompt）───────────────────────────
try:
    import matplotlib
    # 灰度色环：所有系列只用黑白灰
    matplotlib.rcParams["axes.prop_cycle"] = matplotlib.cycler(
        color=["#000000", "#444444", "#777777", "#aaaaaa", "#cccccc"]
    )
    matplotlib.rcParams["lines.color"] = "black"
    matplotlib.rcParams["patch.facecolor"] = "white"
    matplotlib.rcParams["patch.edgecolor"] = "black"
    matplotlib.rcParams["text.color"] = "black"
    matplotlib.rcParams["axes.facecolor"] = "none"
    matplotlib.rcParams["axes.edgecolor"] = "black"
    matplotlib.rcParams["axes.labelcolor"] = "black"
    matplotlib.rcParams["xtick.color"] = "black"
    matplotlib.rcParams["ytick.color"] = "black"
    matplotlib.rcParams["grid.color"] = "#cccccc"
    matplotlib.rcParams["grid.alpha"] = 0.5
    matplotlib.rcParams["figure.facecolor"] = "none"
    matplotlib.rcParams["legend.facecolor"] = "white"
    matplotlib.rcParams["legend.edgecolor"] = "black"
    matplotlib.rcParams["legend.fancybox"] = False
except Exception:
    pass


# ── 数据解析 ────────────────────────────────────────────────────────────────

def parse_data(data_args: list[str]) -> dict[str, list[float]]:
    """将 --data "名称:1|2|3" 解析为 {名称: [1,2,3]}"""
    result = {}
    for d in data_args:
        m = re.match(r"^([^:]+):(.+)$", d)
        if not m:
            print(f"错误：数据格式无效: {d}", file=sys.stderr)
            sys.exit(1)
        name = m.group(1)
        raw_values = [v.strip() for v in m.group(2).split("|") if v.strip()]
        # 校验每个值是否为有效数字
        values = []
        for v in raw_values:
            try:
                values.append(float(v))
            except ValueError:
                print(f"错误：数据「{name}」中包含非数字值: {v}", file=sys.stderr)
                sys.exit(1)
        result[name] = values
    return result


def parse_matrix(data_args: list[str]) -> list[list[float]]:
    """将 --data "1,2,3|4,5,6" 解析为矩阵 [[1,2,3],[4,5,6]]"""
    matrix = []
    for d in data_args:
        for row in d.split("|"):
            row = row.strip()
            if row:
                matrix.append([float(v.strip()) for v in row.split(",") if v.strip()])
    return matrix


# ── 工具 1：Matplotlib ─────────────────────────────────────────────────────

def _chart_matplotlib(args: argparse.Namespace, data: dict) -> str:
    import matplotlib.pyplot as plt
    import numpy as np

    fig, ax = plt.subplots(figsize=(8, 5))
    fig.patch.set_facecolor("none")
    ax.set_facecolor("none")

    t = args.type
    x_labels = args.x.split("|") if args.x else None
    title = args.title or ""
    xlabel = args.xlabel or ""
    ylabel = args.ylabel or ""

    if t == "bar":
        names = list(data.keys())
        values = list(data.values())
        n_groups = len(values)
        n_items = max(len(v) for v in values) if values else 0
        x = np.arange(n_items)
        bar_width = 0.8 / n_groups if n_groups else 0.8
        for i, (name, vals) in enumerate(zip(names, values)):
            offset = (i - n_groups / 2 + 0.5) * bar_width
            bars = ax.bar(x + offset, vals, bar_width, label=name,
                          edgecolor="black", linewidth=0.5)
            for bar in bars:
                ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height(),
                        f"{bar.get_height():.1f}", ha="center", va="bottom", fontsize=8)
        ax.set_xticks(x)
        ax.set_xticklabels(x_labels or [str(i + 1) for i in range(n_items)])

    elif t == "line":
        for name, vals in data.items():
            ax.plot(vals, marker="o", label=name)
        if x_labels:
            ax.set_xticks(range(len(x_labels)))
            ax.set_xticklabels(x_labels)

    elif t == "pie":
        first = list(data.values())[0] if data else []
        labels = x_labels or [f"项{i+1}" for i in range(len(first))]
        # 灰度色盘
        _gray_colors = ["#333333", "#555555", "#777777", "#999999", "#bbbbbb", "#dddddd"]
        wedges, texts, autotexts = ax.pie(
            first, labels=labels, autopct="%1.1f%%",
            colors=_gray_colors[:len(first)],
            textprops={"fontsize": 9},
            wedgeprops={"edgecolor": "black", "linewidth": 0.5},
        )
        ax.set_title(title, fontsize=12)

    elif t == "scatter":
        x_vals = data.get("x", [])
        y_vals = data.get("y", [])
        if not x_vals or not y_vals:
            print("错误：散点图需要 --data x:... 和 --data y:...", file=sys.stderr)
            sys.exit(1)
        ax.scatter(x_vals, y_vals, c="black", s=20, edgecolors="black", linewidths=0.3)
        if x_labels:
            ax.set_xticks(range(len(x_labels)))
            ax.set_xticklabels(x_labels)

    else:
        print(f"错误：Matplotlib 不支持 type={t}", file=sys.stderr)
        sys.exit(1)

    ax.set_title(title, fontsize=12)
    if xlabel:
        ax.set_xlabel(xlabel)
    if ylabel:
        ax.set_ylabel(ylabel)
    if t != "pie" and len(data) > 1:
        ax.legend(fontsize=9)

    plt.tight_layout()
    out = args.output
    fmt = Path(out).suffix.lstrip(".") or "png"
    fig.savefig(out, format=fmt, bbox_inches="tight", transparent=True)
    plt.close(fig)
    return out


# ── 工具 2：Seaborn ────────────────────────────────────────────────────────

def _chart_seaborn(args: argparse.Namespace, data: dict) -> str:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import seaborn as sns
    import numpy as np
    import pandas as pd

    sns.set_theme(style="whitegrid", font=_CN_FONT)

    fig, ax = plt.subplots(figsize=(8, 5))
    fig.patch.set_facecolor("none")
    ax.set_facecolor("none")

    t = args.type
    title = args.title or ""

    if t == "scatter":
        x_vals = data.get("x", [])
        y_vals = data.get("y", [])
        if not x_vals or not y_vals:
            print("错误：散点图需要 --data x:... 和 --data y:...", file=sys.stderr)
            sys.exit(1)
        df = pd.DataFrame({"x": x_vals, "y": y_vals})
        sns.scatterplot(data=df, x="x", y="y", ax=ax, color="black", s=30)

    elif t == "box":
        df_rows = []
        for name, vals in data.items():
            for v in vals:
                df_rows.append({"group": name, "value": v})
        df = pd.DataFrame(df_rows)
        sns.boxplot(data=df, x="group", y="value", ax=ax, color="white",
                    linewidth=1, fliersize=3)

    elif t == "violin":
        df_rows = []
        for name, vals in data.items():
            for v in vals:
                df_rows.append({"group": name, "value": v})
        df = pd.DataFrame(df_rows)
        sns.violinplot(data=df, x="group", y="value", ax=ax, color="white",
                       linewidth=1)

    elif t == "heatmap":
        matrix = parse_matrix(args.data)
        if not matrix:
            print("错误：热力图需要 --data 提供矩阵数据", file=sys.stderr)
            sys.exit(1)
        arr = np.array(matrix)
        x_labels = args.x.split("|") if args.x else None
        y_labels = args.y.split("|") if args.y else None
        sns.heatmap(arr, annot=True, fmt=".1f", linewidths=0.5,
                    xticklabels=x_labels, yticklabels=y_labels,
                    cmap="Greys", cbar=True, ax=ax,
                    cbar_kws={"edgecolors": "black"})

    else:
        print(f"错误：Seaborn 不支持 type={t}", file=sys.stderr)
        sys.exit(1)

    ax.set_title(title, fontsize=12)
    plt.tight_layout()
    out = args.output
    fmt = Path(out).suffix.lstrip(".") or "png"
    fig.savefig(out, format=fmt, bbox_inches="tight", transparent=True)
    plt.close(fig)
    return out


# ── 主入口 ──────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="统一图表生成工具（PNG 输出）")
    parser.add_argument("--tool", type=str, default="1",
                        help="后端工具：1=Matplotlib, 2=Seaborn")
    parser.add_argument("--type", type=str, required=True,
                        help="图表类型：bar line pie scatter box violin heatmap")
    parser.add_argument("--data", type=str, action="append", default=[],
                        help="数据，格式：名称:值1|值2|值3（可多次使用）")
    parser.add_argument("--x", type=str, default="",
                        help="X 轴标签 / 饼图标签，| 分隔")
    parser.add_argument("--y", type=str, default="",
                        help="Y 轴标签（热力图行名），| 分隔")
    parser.add_argument("--title", type=str, default="", help="图表标题")
    parser.add_argument("--xlabel", type=str, default="", help="X 轴标题")
    parser.add_argument("--ylabel", type=str, default="", help="Y 轴标题")
    parser.add_argument("--output", type=str,
                        default="/mnt/user-data/chart.png",
                        help="输出文件路径（.svg 或 .png，默认 png）")
    args = parser.parse_args()

    # 确保输出目录存在
    out_dir = Path(args.output).parent
    out_dir.mkdir(parents=True, exist_ok=True)

    # 解析数据
    # tool=2+heatmap 用 parse_matrix（矩阵格式），需跳过 parse_data
    tool = args.tool
    if tool == "2" and args.type == "heatmap":
        data = {}
    else:
        data = parse_data(args.data)
    if tool == "1":
        _chart_matplotlib(args, data)
    elif tool == "2":
        _chart_seaborn(args, data)
    else:
        print(f"错误：不支持 --tool={tool}，可选 1(Matplotlib) 2(Seaborn)",
              file=sys.stderr)
        sys.exit(1)

    ext = Path(args.output).suffix.upper()
    print(f"{ext}: {args.output}")
    print("图表已生成，可通过 ![图注](路径) 在 Markdown 中引用")


if __name__ == "__main__":
    main()
