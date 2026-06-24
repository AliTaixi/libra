"""将 Word 文档正文转换为 Markdown，自行计算标题编号（1, 1.1, 1.1.1...）。

支持中文编号识别：如果文档中存在"一、""二、"等中文编号，
则自动将其视为一级标题，"1."类阿拉伯编号降为二级，"1.1."降为三级。
若无中文编号，保持原行为。

用法：
  python docx_to_md.py 模板.docx output.md
  python docx_to_md.py 模板.docx --chapters  # 输出章节 JSON
"""
import re, json, sys
from pathlib import Path
from docx import Document

# ── 中文编号正则 ──────────────────────────────────────────────────────────
# 匹配 "一、", "二、", "三、" 等（要求紧跟 、 或 ．，避免匹配正文中的"一个"）
CN_MAIN = re.compile(r"^[一二三四五六七八九十百千]+[、．]")


def _infer_level(text: str, has_cn: bool) -> int:
    """根据标题文字推断层级。

    规则：
      - 如果文档中存在中文编号（一、二、三...）：
          中文编号 → 一级
          "x.x" 格式 → 二级（1个点）
          "x.x.x" 格式 → 三级（2个点）
          纯 "1."、"2." 阿拉伯编号（无点） → 二级
      - 如果文档无中文编号：
          保持原行为（由 Word 样式决定，默认不修改）
    """
    if not has_cn:
        return 0  # 0 = 不修改，保持原 level

    # 中文编号 → 一级
    if CN_MAIN.match(text):
        return 1

    # 阿拉伯编号：数点
    m = re.match(r"^\d+(\.\d+)*", text)
    if m:
        dots = m.group(0).count(".")
        if dots >= 2:
            return 3
        elif dots >= 1:
            return 2
        else:
            # "1"、"2" 纯数字 → 视为阿拉伯一级，但有中文时降为二级
            return 2

    return 0  # 不修改


def extract(docx_path: str) -> tuple[list[dict], str]:
    """返回 (chapters, md_text)"""
    doc = Document(docx_path)

    # ── 第一遍：收集所有段落 ─────────────────────────────────────────
    raw_entries: list[tuple[int, str]] = []
    for para in doc.paragraphs:
        text = para.text.strip()
        style = para.style.name if para.style else ""
        style_lower = style.lower()
        if "toc" in style_lower:
            continue
        if not text:
            continue
        is_heading = "heading" in style_lower or "标题" in style
        if is_heading:
            m = re.search(r"(\d+)$", style)
            level = int(m.group(1)) if m else 1
            raw_entries.append((level, text))
        else:
            raw_entries.append((0, text))

    # 找到第一个一级标题作为起点
    start = None
    for i, (level, _) in enumerate(raw_entries):
        if level == 1:
            start = i
            break
    if start is not None:
        raw_entries = raw_entries[start:]

    # ── 第二遍：检测是否有中文编号，调整层级 ────────────────────────
    heading_texts = [t for lv, t in raw_entries if lv > 0]
    has_chinese_num = any(CN_MAIN.match(t) for t in heading_texts)

    entries: list[tuple[int, str]] = []
    for level, text in raw_entries:
        if level == 0:
            entries.append((0, text))
        else:
            inferred = _infer_level(text, has_chinese_num)
            entries.append((inferred if inferred > 0 else level, text))

    # ── 第三遍：生成章节结构 ─────────────────────────────────────────
    counters = [0] * 10
    chapters = []
    md_parts = []
    cur_ch = None
    cur_h2 = None
    body_buf = []

    def _num_str(level_idx: int) -> str:
        return ".".join(str(counters[i]) for i in range(level_idx) if counters[i] > 0)

    for level, text in entries:
        if level == 0:
            body_buf.append(text)
            continue

        if cur_ch is not None and body_buf:
            body_text = "\n".join(body_buf)
            cur_ch["body_text"] = body_text
            md_parts.append(body_text + "\n")
            body_buf = []

        counters[level - 1] += 1
        for j in range(level, len(counters)):
            counters[j] = 0

        # 如果标题已含编号（中文"一、"或阿拉伯"1.1"），不重复加数字前缀
        if CN_MAIN.match(text) or re.match(r'^\d+(\.\d+)*\s', text):
            full = text
        else:
            num = _num_str(level)
            full = f"{num} {text}"
        prefix = "#" * level
        md_parts.append(f"\n{prefix} {full}\n")

        if level == 1:
            cur_ch = {"id": str(len(chapters) + 1), "title": full, "structure": [], "body_text": ""}
            chapters.append(cur_ch)
            cur_h2 = None
        elif level == 2 and cur_ch is not None:
            cur_h2 = {"level": 2, "title": full, "children": []}
            cur_ch["structure"].append(cur_h2)
        elif level >= 3 and cur_h2 is not None:
            cur_h2["children"].append({"level": level, "title": full})

    if cur_ch is not None and body_buf:
        body_text = "\n".join(body_buf)
        cur_ch["body_text"] = body_text
        md_parts.append(body_text + "\n")

    return chapters, "\n".join(md_parts)


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    flags = set(a for a in sys.argv[1:] if a.startswith("--"))
    if not args:
        print("用法: python docx_to_md.py [--chapters] 输入.docx [输出.md]")
        sys.exit(1)
    chs, md = extract(args[0])
    if "--chapters" in flags:
        print(json.dumps(chs, ensure_ascii=False, indent=2))
    elif len(args) >= 2:
        Path(args[1]).write_text(md, encoding="utf-8")
        print(f"已保存: {args[1]} ({len(md)} 字符)")
    else:
        print(md[:2000])
