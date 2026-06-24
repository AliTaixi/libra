---
name: 图表绘制
description: 用 Mermaid 文本描述生成各类型技术图表。输出 PNG。
---
# 图表绘制 Skill

## 工作流程

### 第一步：确定图类型

参考下方的"图类型速查表"选择适合的图类型。

### 第二步：写 Mermaid 文本

按速查表中的"语法开头"和"一行示例"编写 Mermaid 描述。

### 第三步：保存到 .mmd 文件

```bash
# 将 Mermaid 文本写入文件
cat > /mnt/user-data/diagram.mmd << 'EOF'
graph TD;
  A[开始]-->B[处理];
  B-->C[结束];
EOF
```

### 第四步：调用渲染脚本

```bash
# 输出 PNG（默认）
bash /mnt/skills/public/diagram-code-generation/scripts/render.sh \
  /mnt/user-data/diagram.mmd \
  /mnt/user-data/output.png \
  png

# 输出 SVG（第三个参数不传或传 svg）
bash /mnt/skills/public/diagram-code-generation/scripts/render.sh \
  /mnt/user-data/diagram.mmd \
  /mnt/user-data/output.svg
```

### 第五步：在文档中引用

PNG：`![图注](/mnt/user-data/output.png)`
SVG：`![图注](/mnt/user-data/output.svg)`

## 图类型速查


| 图类型    | 语法开头             | 一行示例                                                              |
| --------- | -------------------- | --------------------------------------------------------------------- |
| 流程图    | `graph TD/LR/RL/BT`  | `graph TD; A[开始]-->B[结束];`                                        |
| 时序图    | `sequenceDiagram`    | `sequenceDiagram; A->>B: 消息;`                                       |
| 类图      | `classDiagram`       | `classDiagram; class Animal{};`                                       |
| 状态图    | `stateDiagram-v2`    | `stateDiagram-v2; [*] --> 状态1;`                                     |
| ER 图     | `erDiagram`          | `erDiagram; A 关系 B;`                                                |
| 甘特图    | `gantt`              | `gantt; title 项目; section 阶段; 任务1 :a1, 1d;`                     |
| 用户旅程  | `journey`            | `journey; title 体验; section 阶段; 操作: 5: 用户;`                   |
| 需求图    | `requirementDiagram` | `requirementDiagram; req Req1 { id: 1; text: 需求; }`                 |
| Git 图    | `gitGraph`           | `gitGraph; commit; branch dev; checkout dev; commit;`                 |
| C4 上下文 | `C4Context`          | `C4Context; Person(用户, "用户"); System(系统, "系统");`              |
| 时间线    | `timeline`           | `timeline; title 历史; 2020: 事件A; 2021: 事件B;`                     |
| 块图      | `block`              | `block; A[块A] B[块B]; A --> B;`                                      |
| 看板      | `kanban`             | `kanban; todo[待办]; doing[进行]; done[完成];`                        |
| 架构图    | `architecture-beta`  | `architecture-beta; group 层(cloud)[云]; service 服务(server)[服务];` |
| 石川图    | `ishikawa`           | `ishikawa; title 分析; 原因A-->结果; 原因B-->结果;`                   |

## ⚠️ 硬性规则

1. **禁止在节点名中使用 emoji**（如 🙋 🤖 🧠 等），只能用纯文字
2. **禁止使用 `classDef` 定义颜色** — 渲染器已统一为黑白透明风格
3. 活动图/流程图避免复杂循环路径（如 A→B→C→A），dagre 布局引擎无法处理循环
4. 不要写 Python 脚本生成 SVG/PNG，只使用 `render.sh`
