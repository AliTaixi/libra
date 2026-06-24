---
name: Markdown 转 Word
description: 将 Markdown 文件转换为格式化的 .docx 文档。正文首行缩进，一级标题居中，全黑色字体。
compatibility:
  python: ">=3.12"
---
# Markdown 转 Word Skill

# Markdown 转 Word Skill

⚠️ **硬性规则：禁止手写 Python 脚本，禁止用 write_file 创建 .py 文件。所有转换必须通过 bash 调用 convert.sh 完成。**

## 工作流程

### 第一步：用 Markdown 写内容

先用 Markdown 格式写文案，然后用 `write_file` 工具保存到 `/mnt/user-data/content.md`。
注意 `write_file` 的第一个参数是 `description`（必填），调用示例：

```
write_file(description="保存markdown内容", path="/mnt/user-data/content.md", content="...markdown内容...")
```

### 第二步：调用转换脚本

通过 `bash` 工具调用脚本。

**必填入参：**
```
bash 工具
  命令: bash /mnt/skills/public/md-to-docx-skill/scripts/convert_md_to_docx.sh
  --input  /mnt/user-data/<输入文件名.md>     ← 必填，第一步保存的 md 文件
  --output /mnt/user-data/<输出文件名.docx>   ← 必填，转换结果文件
```

**完整示例：**
```bash
bash /mnt/skills/public/md-to-docx-skill/scripts/convert_md_to_docx.sh \
  --input /mnt/user-data/content.md \
  --output /mnt/user-data/输出.docx
```

### 第三步：用 present_files 呈现结果给用户

## 参数参考

| 参数 | 说明 |
|------|------|
| `--input` | Markdown 文件路径（必填） |
| `--output` | 输出 .docx 路径（默认 `/mnt/user-data/输出.docx`） |

## 字体规范

- **中文**：宋体（SimSun）
- **英文**：Times New Roman
- **代码**：Courier New
- **所有文字颜色为黑色**（可加粗）

## 编号规范

标题和列表项必须按以下格式手动编号（脚本不会自动编号）：

| 级别 | 格式 | 示例 |
|------|------|------|
| 一级标题 | `一、` `二、` `三、` | `# 一、引言` |
| 二级标题 | `1.1` `1.2` | `## 1.1 背景` |
| 三级标题 | `1.1.1` `1.1.2` | `### 1.1.1 问题分析` |
| 列表项 | `(1)` `(2)` `(3)` | `(1) 第一项` |

禁止使用 `·`、`①`、`②` 等符号，一律用 `(1)` `(2)` 格式。

## 格式参考

| 类型 | Markdown 语法 | 说明 |
|------|--------------|------|
| 标题 | `#` `##` `###` | 手动按编号规范加前缀，一级标题居中 |
| 加粗 | `**文字**` |  |
| 斜体 | `*文字*` |  |
| 列表项 | `(1) 项目` 等 | 禁止使用 ·、① 等符号 |
| 表格 | `\| 列1 \| 列2 \|` | 带边框 + 灰色表头 |
| 图片 | `![图注](路径)` | SVG 自动转 PNG 后插入 |
| 代码块 | `` ``` `` | Courier New + 浅灰底纹 |
| 引用 | `> 文字` | 左缩进 + 灰色左边框 |
| 分隔线 | `---` | 水平线 |
| 正文缩进 | 自动 | 每段首行自动缩进 2 字符 |

## 注意事项

- 所有依赖已预装，不要手动安装
- 不要读取 `convert_md_to_docx.py` 文件内容
- 不要写 .py 文件或手写 python-docx 代码
- 所有转换必须通过 `convert_md_to_docx.sh` 脚本完成
