---
name: 图表生成
description: 用 Python（Matplotlib / Seaborn）生成各类统计图表。输出 PNG 图片。
---
# 图表生成 Skill

## 工作流程

### 第一步：确定图表类型

参考下方的"图表类型速查表"确定要使用的 `--tool` 和 `--type`。

### 第二步：调用脚本生成图表（在沙箱中运行）

```bash
# 输出 PNG（默认）
python /mnt/skills/public/chart-code-generation/scripts/generate.py \
  --tool 1 \
  --type bar \
  --data "得分:92.5|88.3|95.1|89.7" \
  --x "类别A|类别B|类别C|类别D" \
  --title "各类别得分对比" \
  --ylabel "得分" \
  --output /mnt/user-data/chart.png

# 输出 SVG（加 .svg 后缀）
python /mnt/skills/public/chart-code-generation/scripts/generate.py \
  --tool 1 --type pie --data "占比:30|50|20" --x "A|B|C" \
  --output /mnt/user-data/chart.svg
```


## 图表类型速查

| 图表类型 | `--tool`         | `--type` 值 | 一行示例                                                                       |
| -------- | ------------------ | ------------- | ------------------------------------------------------------------------------ |
| 柱状图   | `1` (Matplotlib) | `bar`       | `--type bar --data "值:10\|20\|30" --x "A\|B\|C"`                                |
| 折线图   | `1` (Matplotlib) | `line`      | `--type line --data "值:1\|2\|3" --x "Q1\|Q2\|Q3"`                               |
| 饼图     | `1` (Matplotlib) | `pie`       | `--type pie --data "占比:30\|50\|20" --x "A\|B\|C"`                              |
| 散点图   | `1` (Matplotlib) | `scatter`   | `--type scatter --data "x:1\|2\|3\|4 --data y:2\|4\|1\|3"`                         |
| 散点图   | `2` (Seaborn)    | `scatter`   | `--tool 2 --type scatter --data "x:1\|2\|3\|4 --data y:2\|4\|1\|3"`                |
| 箱线图   | `2` (Seaborn)    | `box`       | `--tool 2 --type box --data "组A:2\|4\|6\|8\|10" --data "组B:1\|3\|5\|7\|9"`         |
| 小提琴图 | `2` (Seaborn)    | `violin`    | `--tool 2 --type violin --data "组A:2\|4\|6\|8" --data "组B:1\|3\|5\|7"`           |
| 热力图   | `2` (Seaborn)    | `heatmap`   | `--tool 2 --type heatmap --data "1,2,3\|4,5,6\|7,8,9" --x "A\|B\|C" --y "X\|Y\|Z"` |

---

## 工具选择

| `--tool` | 后端库                     | 适用图表                         |
| ---------- | -------------------------- | -------------------------------- |
| `1`      | Matplotlib                 | 柱状图、折线图、饼图、散点图     |
| `2`      | Seaborn（基于 Matplotlib） | 散点图、箱线图、小提琴图、热力图 |

---

---

## 参数参考

| 参数         | 必填 | 说明                                                                                               |
| ------------ | ---- | -------------------------------------------------------------------------------------------------- |
| `--tool`   | ✅   | `1`(Matplotlib)、`2`(Seaborn)                                                |
| `--type`   | ✅   | 图表类型：`bar` `line` `pie` `scatter` `box` `violin` `heatmap` |
| `--data`   | ✅   | 数据，可多次使用。格式见各类型示例                                                                 |
| `--x`      |      | X 轴标签 / 饼图标签，用 `\|` 分隔                                                                 |
| `--y`      |      | Y 轴标签（热力图行名），用 `\|` 分隔                                                              |
| `--title`  |      | 图表标题                                                                                           |
| `--xlabel` |      | X 轴标题                                                                                           |
| `--ylabel` |      | Y 轴标题                                                                                           |
| `--output` |      | 输出路径，默认 `/mnt/user-data/chart.svg`                                                        |

---

## 注意事项

- 多组 `--data` 自动生成分组柱状图或多条折线
- 所有依赖已预装，不要手动安装包
