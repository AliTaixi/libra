# Libra — 服务器部署指南

> 基于 LangGraph 框架的 AI Agent 系统，支持全文写作、知识库、图表生成等能力。

---

## 目录

1. [项目配置](#1-项目配置)
2. [启动数据库](#2-启动数据库)
3. [构建并启动服务](#3-构建并启动服务)
4. [访问服务](#4-访问服务)
5. [服务说明](#5-服务说明)
6. [常见问题](#6-常见问题)

---

## 1. 项目配置

### 1.1 环境变量

复制环境变量模板并编辑：

```bash
cd /path/to/Libra
cp .env.example .env
```

### 1.2 config.yaml

`config.yaml` 是项目主配置文件，主要关注以下部分：

**模型配置** — 根据实际部署的 Ollama 模型修改（可通过网页设置->模型配置手动更改）：

```yaml
models:
  - name: gemma4-cloud
    display_name: Gemma 4 31B (云端)
    model: gemma4:31b       # 对应 ollama pull 的模型名
    base_url: http://host.docker.internal:11434  # Ollama 地址
    num_ctx: 128000          # 上下文长度
    num_predict: 32768       # 最大输出 token
```

---

## 2. 启动数据库

本项目使用 PostgreSQL 作为数据库，版本不限制。如果服务器上已有 PostgreSQL 实例，直接修改 `.env` 中的 `DATABASE_URL` 指向它即可，无需另起新容器。

如果没有现成的，通过 Docker 启动：

```bash
cd /path/to/Libra/docker
docker compose -f docker-compose.db.yml -p libra up -d
```

---

## 3. 构建并启动服务

所有命令在 `Libra/` 目录下执行。

### 3.1 各服务镜像说明

以下列出 docker-compose.yaml 中定义的所有服务，以及你的服务上可能有不同版本时的处理方式。

| 服务           | 镜像来源        | compose 中配置                                      |                                                                             |
| -------------- | --------------- | --------------------------------------------------- | --------------------------------------------------------------------------- |
| gateway        | Dockerfile 构建 | `build: gateway.Dockerfile`                       |                                                                             |
| frontend       | Dockerfile 构建 | `build: frontend.Dockerfile`                      |                                                                             |
| whisper        | Dockerfile 构建 | `build: whisper.Dockerfile`                       |                                                                             |
| mineru         | Dockerfile 构建 | `build: mineru.Dockerfile`                        | 服务器上已有 `mineru`镜像，可修改 yaml 中 build 配置，直接用 image 名    |
| mermaid-server | Dockerfile 构建 | `build: mermaid.Dockerfile`                       | 服务器上已有 mermaid 镜像，可修改删除 yaml 中 build 配置，直接用 image 名  |
| nginx          | 公共镜像        | `image: nginx:alpine`                             |                                                                             |
| drawio         | 公共镜像        | `image: jgraph/drawio:latest`                     |                                                                             |
| postgres       | 公共镜像        | `image: postgres:18`（在docker-compose.db.yml中） | 如需使用服务器上已有版本，手动把 yaml 中的 tag 改为对应版本号即可。功能兼容 |

> 公共镜像默认 tag 是选定的版本号（如 `postgres:18`），服务器上只有旧版本时 Docker 不会自动使用它，会重新拉取指定 tag。**想用本地旧版本 → 手动改 yaml 里的 tag**。

### 3.2 持久化数据卷

| Volume 名           | 挂载点                          | 内容                                |
| ------------------- | ------------------------------- | ----------------------------------- |
| `whisper-models`  | `/root/.cache/faster_whisper` | faster-whisper 模型文件（large-v3） |
| `deerflow-pgdata` | `/var/lib/postgresql/data`    | PostgreSQL 数据文件                 |

### 3.3 首次构建（build）

有 Dockerfile 的镜像首次部署需要构建。如果服务器上已经存在对应镜像，可以跳过构建，直接启动。

需要构建的镜像：

```bash
cd /path/to/Libra

docker compose -f docker/docker-compose.yaml -p libra build gateway
docker compose -f docker/docker-compose.yaml -p libra build frontend
docker compose -f docker/docker-compose.yaml -p libra build whisper-server

# 以下两个如果服务器上已有镜像可跳过构建
docker compose -f docker/docker-compose.yaml -p libra build mineru
docker compose -f docker/docker-compose.yaml -p libra build mermaid-server
```

### 3.4 启动所有服务

```bash
docker compose -f docker/docker-compose.yaml -p libra up -d
```

### 3.5 停止服务

```bash
docker compose -f docker/docker-compose.yaml -p libra down
```

### 3.6 查看启动状态

```bash
docker compose -f docker/docker-compose.yaml -p libra ps
```

所有服务状态应为 `Up`。

### 3.7 查看日志

```bash
# 全部服务日志
docker compose -f docker/docker-compose.yaml -p libra logs -f

# 单个服务日志
docker logs libra-gateway
docker logs libra-whisper
```

### 3.8 常用操作

```bash
# 重新构建单服务（改代码后）
docker compose -f docker/docker-compose.yaml -p libra build gateway
docker compose -f docker/docker-compose.yaml -p libra up -d gateway
```

---

## 4. 访问服务

```
http://<服务器IP>:2026
```

---
