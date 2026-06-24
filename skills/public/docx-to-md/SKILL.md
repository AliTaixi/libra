---
name: Word 转 Markdown
description: 将 Word 文档（.docx）正文转换为 Markdown 格式，自动识别章节编号。触发词：转md、转markdown、转换word、docx转md、提取word正文
---

# Word 转 Markdown Skill

## 工作流程

### 第一步：确认输入文件

确认用户提供的 .docx 文件路径。

### 第二步：调用转换脚本

通过 `bash` 工具调用脚本。用户上传的文件在 `/mnt/user-data/` 下。

**必填入参：**
```
bash 工具
  命令: bash /mnt/skills/public/docx-to-md/scripts/convert.sh
  参数1: /mnt/user-data/<输入文件名.docx>   ← 必填，用户上传的文件
  参数2: /mnt/user-data/<输出文件名.md>     ← 必填，转换结果文件
```

**完整示例：**
```bash
# 先查看上传的文件名
ls /mnt/user-data/

# 然后执行转换（假设文件叫 模板.docx）
bash /mnt/skills/public/docx-to-md/scripts/convert.sh /mnt/user-data/模板.docx /mnt/user-data/模板.md
```

### 第三步：用 read_file 读取结果并呈现给用户

## 参数参考

| 参数 | 说明 |
|------|------|
| 第一个参数 | 输入 .docx 文件路径（必填） |
| 第二个参数 | 输出 .md 文件路径（可选，默认同目录同名.md） |

## 输出格式

转换结果保留了原文的标题层级和自动编号：

```markdown
# 1 范围

## 1.1 标识

正文内容...

## 1.2 系统概述

正文内容...
```

## 注意事项

- 仅提取正文部分，自动跳过封面和目录
- 标题编号由脚本自动计算（1、1.1、1.1.1）
- 所有依赖已预装，不要手动安装
- 不要读取 `docx_to_md.py` 文件内容
