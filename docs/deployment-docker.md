# Docker 部署

单机 Docker Compose 部署路径。与 `docs/deployment.md` 的裸机 systemd 部署并存，二者选其一。

## 一键启动

```bash
cp docker/env.example .env     # 填入 JWT_SECRET 与 POSTGRES_PASSWORD
docker compose up -d --build
```

启动后访问 `http://127.0.0.1:3000`。首个注册账号会自动成为 `super_admin`，
因此**建议先在后台注册管理员，再按需关闭注册**（`REGISTRATION_ENABLED`）。

```bash
docker compose logs -f app      # 观察迁移与启动日志
docker compose ps              # 健康状态（healthy 表示 /api/health 通过）
```

## 组成

| 服务 | 镜像 | 说明 |
|---|---|---|
| `postgres` | `postgres:16-alpine` | 元数据；命名卷 `pgdata` |
| `redis` | `redis:7-alpine` | Bull 队列；AOF 持久化，卷 `redisdata` |
| `app` | 本仓库 `Dockerfile` | NestJS + 内置前端产物；卷 `appdata` 挂载 `/app/backend/tmp` |

`app` 容器内不运行 nginx：NestJS 直接托管前端（`app.useStaticAssets`），
对外暴露请在前置反向代理（Caddy/nginx）上终止 TLS，再转发到 `127.0.0.1:3000`。

## 迁移

容器 entrypoint 在启动前执行 `typeorm migration:run`：

- 迁移失败 → 容器退出（fail-closed），不会让新版本跑在旧 schema 上；
- 应用自身的 `DB_MIGRATIONS_RUN` 被强制关闭，避免双重执行；
- 多副本部署时应设 `RUN_MIGRATIONS_ON_START=false`，改用一次性 job 执行迁移。

## 数据与备份

| 数据 | 位置 | 是否可丢 |
|---|---|---|
| 元数据 | `pgdata` 卷 | **不可丢**，需定时 `pg_dump` |
| 队列 | `redisdata` 卷 | 丢队列会丢失未完成的异步上传任务 |
| 下载缓存 / 分片 / 日志 | `appdata` 卷 | 可丢，重建即可（仅影响预热与断点续传） |
| 文件本体 | Telegram | 依赖上游，不在卷内 |

## 升级

替换镜像版本并重建：

```bash
git pull && docker compose up -d --build
```

应用内「系统更新」已在本仓库移除，升级只走上述流程。

## 大文件支持：本地 Bot API（可选）

官方 `api.telegram.org` 对下载有 20MB 上限。要支持更大的文件，启用仓库自带的
Bot API 服务（二次开发的 TDLib fork，含流式文件端点）：

```bash
# 1. .env 里补三项（API_ID/HASH 来自 my.telegram.org，不是 Bot Token）
#    TELEGRAM_API_ID=123456
#    TELEGRAM_API_HASH=abcdef...
#    TELEGRAM_API_BASE=http://bot-api:8081
#    TELEGRAM_LOCAL_FILE_DIR=/var/lib/telegram-bot-api

# 2. 连带 bot-api 一起启动
docker compose --profile botapi up -d --build
```

要点：

- 首次构建会**编译 TDLib**（约 15–30 分钟，峰值内存约 2GB）；也可以直接拉预构建镜像，
  把 compose 里 `bot-api` 服务的 `build:` 换成
  `image: ghcr.io/jacob-bytes/nebula-bot-api:latest`。
- `botapi-workdir` 卷必须持久化：本地 Bot API 返回的 `file_path` 是容器内绝对路径，
  且历史 `file_id` 与 workdir 强绑定，删卷等于让已上传文件全部失效。
- 该服务**不对外暴露端口**，只有 `app` 通过 compose 内网访问。
- 两个容器以相同路径挂载同一卷（app 侧只读），后端才能按 `file_path` 直接读文件。

## 使用预构建镜像

```bash
docker pull ghcr.io/jacob-bytes/nebula:latest     # amd64 + arm64
```

把 `docker-compose.yml` 中 `app` 服务的 `build:` 段替换为
`image: ghcr.io/jacob-bytes/nebula:latest` 即可，其余不变。

## 备份与恢复

```bash
# 备份（默认走 .env 直连；容器部署用 --compose 在 postgres 容器内导出）
scripts/ops/backup.sh --compose --keep 7

# 恢复到新机器 / 回滚
scripts/ops/restore.sh backups/20261101-153300 --compose --force
```

快照目录含 `MANIFEST.txt`（版本、类型、大小、sha256）。恢复前会校验 sha256，
不匹配直接拒绝；目标库非空时必须显式 `--force`。SQLite 模式采用原子替换，
PostgreSQL 使用 `pg_restore --clean --if-exists`。

**不包含**：`.env`（含密钥）、Bot API workdir（需整体搬迁）、下载缓存（可重建）。

## 与裸机部署的差异

| 能力 | 裸机 systemd | Docker Compose |
|---|---|---|
| 自动更新 | 已移除 | 已移除 |
| 本地 Bot API（突破 20MB 下载上限） | `start.sh` 安装独立单元 | 需自行增加 bot-api 服务并设置 `TELEGRAM_API_BASE` |
| 大文件磁盘配额 | 依赖宿主机磁盘 | 依赖卷所在磁盘，注意 `FILE_DOWNLOAD_*` 并发与卷容量 |

> 镜像构建需要访问 npm registry 与 Docker Hub；本机未安装 Docker 时无法验证 `docker build`，
> 首次构建请预留 5–10 分钟（前端构建 + 后端编译 + 原生模块安装）。
