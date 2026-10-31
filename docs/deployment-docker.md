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

## 与裸机部署的差异

| 能力 | 裸机 systemd | Docker Compose |
|---|---|---|
| 自动更新 | 已移除 | 已移除 |
| 本地 Bot API（突破 20MB 下载上限） | `start.sh` 安装独立单元 | 需自行增加 bot-api 服务并设置 `TELEGRAM_API_BASE` |
| 大文件磁盘配额 | 依赖宿主机磁盘 | 依赖卷所在磁盘，注意 `FILE_DOWNLOAD_*` 并发与卷容量 |

> 镜像构建需要访问 npm registry 与 Docker Hub；本机未安装 Docker 时无法验证 `docker build`，
> 首次构建请预留 5–10 分钟（前端构建 + 后端编译 + 原生模块安装）。
