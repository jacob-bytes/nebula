# 部署与运维

> 本文档由原 README 拆分而来；文中路径均相对仓库根，省略前缀的源码路径（如 `file/file-cache.service.ts`、`telegram-mirror/*`）相对 `backend/src/`。下载链路的超时分层与反向代理要求见 [download-and-cache.md](download-and-cache.md)，生产环境变量见 [configuration.md](configuration.md)，多实例约束见本文档「部署注意事项」。总索引见 [README](../README.md)。

---


## 一键安装（Linux / systemd）

适合不想用 Docker、也没有现成 Node/PG 环境的机器：一条命令下载发行包、**验签**、
解压到 `/opt/nebula/releases/<版本>`、切换 `current` 符号链接，然后调用发行包内的
`start.sh` 完成首次配置与 systemd 单元安装。

```bash
# 交互式（逐项提问，适合第一次装）
curl -fsSL https://raw.githubusercontent.com/jacob-bytes/nebula/main/scripts/install.sh | sudo bash

# 无人值守（配置全部来自 NEBULA_* 环境变量）
sudo NEBULA_TELEGRAM_BOT_TOKEN=123456:abc \
     NEBULA_TELEGRAM_CHAT_ID=-1001234567890 \
     NEBULA_APP_URL=https://pan.example.com \
     bash install.sh --yes
```


### 零配置安装 + 浏览器向导

若希望安装阶段完全不问配置，加 `--defer-config`：

```bash
curl -fsSL https://raw.githubusercontent.com/jacob-bytes/nebula/main/scripts/install.sh | sudo bash -s -- --defer-config
```

安装完成后终端会打印**一次性安装令牌**与访问地址；打开 `http://<主机>:3000/setup`，
按三步填写站点信息、Telegram 凭据（可点「发送测试消息」验证）与管理员账号即可。

- 令牌同时保存在 `<安装根>/.setup-token`（仅服务用户可读），完成后自动删除；
- 未初始化的实例**一旦暴露公网**，任何能访问 `/setup` 的人都可能抢先设置管理员，
  因此令牌是强制项，不要跳过；
- 完成后应用会写回 `.env` 并退出，systemd（`Restart=on-failure`）带着新配置重新拉起，
  页面刷新即可登录。

要点：

- **验签默认强制**：下载 `SHA256SUMS.sig` 并用对应 tag 的公钥校验，失败即中止且不切换
  `current`。`--insecure-skip-verify` 仅用于离线调试。
- **默认 SQLite**：不装 PostgreSQL；需要 PG 时传 `NEBULA_DB_TYPE=postgres` 与
  `NEBULA_DB_PASSWORD`。
- **不装反向代理、不申请证书**：留给使用者按自己的入口方案处理。
- 安装前可用 `--dry-run` 查看计划（不联网、不写盘）。
- 已有安装时拒绝覆盖；升级请用 `current/scripts/release/upgrade.sh <新发行包.zip>`。
- 可选环境变量：`NEBULA_REDIS_HOST/PORT`、`NEBULA_TELEGRAM_API_ID/HASH`（提供则启用内置
  Bot API）、`NEBULA_SMTP_*`（提供则启用邮件）。

## 发行签名密钥（CI 发布用）

正式发行包要求用私钥签名 `SHA256SUMS`，部署端的 `install.sh` / `upgrade.sh` / `validate-release.sh`
用仓库内 `scripts/release/update-public-key.pem` 验签。

一次性配置：

1. 生成密钥对（或使用仓库内置的那一对，私钥在工作区 `.secrets/release-signing-key.pem`）：

   ```bash
   openssl genrsa -out release-signing-key.pem 3072
   openssl rsa -in release-signing-key.pem -pubout -out scripts/release/update-public-key.pem
   ```

2. 把私钥内容整段（含 `-----BEGIN/END PRIVATE KEY-----`）存为仓库 secret **`RELEASE_SIGNING_KEY`**：
   Settings → Secrets and variables → Actions → New repository secret。
   GitHub 保存后不可再读，只能覆盖；配好跑一次 `Release` 工作流即可验证是否配对
   （`sign-release.sh` 会用内置公钥自检）。

3. 然后在 Actions → Release → Run workflow 勾选 `publish` 产出带制品的 Release。

**轮换 / 泄露**：生成新密钥对 → 提交新公钥 → 覆盖 secret → 重发尚未被下载的版本；
旧包签名无法用新公钥验证，需在 Release 说明里注明。

## 可选依赖：ffmpeg

视频封面（`<fileId>.video.webp`）由后端直接 `spawn ffmpeg` 抽帧生成：

- **Docker 部署**：镜像已内置 ffmpeg，无需额外操作。
- **裸机部署**：需要 `apt-get install -y ffmpeg`（或等价包）。缺失时视频封面会静默生成失败，
  列表退回类型图标——文件本身可正常上传下载，只是没有画面预览。
- 自定义二进制路径可用 `FFMPEG_PATH=/opt/ffmpeg/bin/ffmpeg` 覆盖。

## 环境要求

**最低硬件配置**：

- CPU：2 核
- 内存：4 GB
- 磁盘：缓存卷可用空间 ≥ **最大并发数 × 4 GiB × 2**。「最大并发数」取上游冷回源的并发口径 `FILE_DOWNLOAD_MAX_CONCURRENT_UPSTREAMS`（默认 8；开启自动扩缩容时按有效 Bot 数最多映射到 64），单个并发按 4 GiB 大文件/分卷计，×2 为峰值系数（覆盖「后端缓存 + Bot API workdir」两份本地副本并存）——默认并发下需 **≥ 64 GiB** 可用空间。缓存卷与 Bot API workdir 建议分卷部署并分别配置最低余量（`FILE_CACHE_MIN_FREE_DISK_GB` 与 `--workdir-min-free-bytes`）；运行时准入参数见 [configuration.md](configuration.md)，磁盘域说明见 [download-and-cache.md](download-and-cache.md)。

**软件要求**：

- Node.js 20+（NestJS 11 运行时要求；发行包使用随包提供的 Node runtime）
- npm（项目未使用 yarn 或 pnpm）
- PostgreSQL 14+（默认、推荐用于多实例和较高写并发），或 SQLite 3（仅单实例/低写并发，必须设置 `DB_TYPE=sqlite`）
- Redis（两种数据库模式均必需，Bull 队列不由 SQLite 替代）
- Telegram Bot Token 与用于存储文件的 Chat ID（两种数据库模式均必需，SQLite 只保存元数据）
- 可选：SMTP 服务
- 可选：自建或本项目二次开发的 `telegram-bot-api`


## 快速开始

### 1. 创建数据库

```sql
CREATE DATABASE file_distribution;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```

迁移会尝试创建 `uuid-ossp`。如果数据库账号没有创建扩展的权限，请先使用 PostgreSQL 超级用户执行第二条语句。

SQLite 无需创建数据库服务，但不会被默认启用。SQLite 单机首次部署示例：

```env
DB_TYPE=sqlite
DB_DATABASE=./data/nebula.sqlite
DB_SQLITE_BUSY_TIMEOUT_MS=5000
DB_MIGRATIONS_RUN=false
```

随后在 `backend` 工作目录执行 `npm run migration:run:sqlite`。相对数据库路径按进程当前工作目录解析，因此 systemd/容器/PM2 的工作目录必须固定且与迁移命令一致。

### 2. 配置并启动后端

```bash
cd backend
cp .env.example .env
npm install
npm run migration:run
npm run start:dev
```

启动前必须编辑 `backend/.env`，至少正确设置：

- `DB_HOST`、`DB_PORT`、`DB_USERNAME`、`DB_PASSWORD`、`DB_DATABASE`
- 长度不少于 32 字符的 `JWT_SECRET`
- `TELEGRAM_BOT_TOKEN`、`TELEGRAM_CHAT_ID`
- `CORS_ORIGINS=http://localhost:5173`

如启用 Bot 入站文件直链（默认**关闭**），还需配置 `TELEGRAM_BOT_UPDATES_ENABLED=true`、`TELEGRAM_BOT_ADMIN_IDS`（初始管理员 TG 用户 ID）、`TELEGRAM_BOT_ENCRYPTION_KEY`（32 字节 base64/hex，用于直链回放），并在后台「Telegram Bot 设置」中确认站点域名。

如果配置了 `SMTP_HOST`，还必须同时配置完整 SMTP 参数以及 `SMTP_ENCRYPTION_KEY`、`SMTP_ENCRYPTION_SALT`；否则启动校验会拒绝启动。暂不使用邮件时，应移除或注释全部 SMTP 配置，并在系统认证配置中关闭依赖邮件的功能。

后端开发服务器默认监听 `http://0.0.0.0:3000`。

### 3. 启动前端

```bash
cd frontend
npm install
npm run dev
```

前端默认访问地址为 `http://localhost:5173`，Vite 将 `/api` 代理到 `http://localhost:3000`。

如需修改开发代理目标，在 `frontend/.env` 中设置：

```env
VITE_API_PROXY_TARGET=http://localhost:3000
```

生产前端固定使用同源 `/api`，不读取独立 API 基址。


## Linux x64 预编译发行版

正式发行文件按版本存放于 `.Releases/v<版本>/`。完整 Linux x64 包包含已构建前端、后端生产依赖、Node.js 运行时和二次开发 Telegram Bot API 可执行文件：

```text
.Releases/
└── vX.Y.Z/
    ├── nebula-vX.Y.Z-linux-x64.zip
    ├── SHA256SUMS
    └── RELEASE.txt
```

`ZIP` 是唯一支持的发行压缩格式。归档必须且只能含 `nebula-vX.Y.Z-linux-x64/` 顶层目录，且包内 `VERSION`、顶层目录、ZIP 文件名及 `SHA256SUMS` 的资产名必须为同一版本。归档至少包含 `backend/`、`frontend/index.html`、`runtime/bin/node`、`telegram-bot-api/bin/telegram-bot-api`、`bin/nebula`、`start.sh` 和完整的 `scripts/release/` 运维脚本。

发行包不包含 TypeScript 源码、测试、source map、开发依赖、`.env`、数据库、Redis 持久化、Telegram Bot API workdir、上传分片、日志、缓存或用户数据。`start.sh`、运行二进制和可执行运维脚本必须保留 Unix 可执行权限。数据库结构仍由包内编译后的正式运行时迁移维护；这些迁移不是开发文件，新库初始化和后续升级均依赖它们。


## 发行包部署、升级与回退

> 本仓库已移除应用内「系统更新」（后端 `update` 模块、systemd oneshot 单元与 polkit 规则）。
> 升级与回退一律由运维在部署机执行下述脚本，管理后台不再提供一键升级入口。

`VERSION` 是唯一的发行版本源，必须与前后端 `package.json` 和 lockfile 根包版本一致。Linux x64 构建在 Linux 环境执行：

```bash
bash scripts/build-linux-x64-release.sh
```

构建产物包含 `backend/`、`frontend/`、`telegram-bot-api/`、`runtime/`、`bin/`、`start.sh` 和 `scripts/release/`。首次安装使用包根目录的 `./start.sh`；已使用 `current` 符号链接部署的实例可使用：

```bash
# 检查真实服务、数据库依赖、前端入口和运行版本
./scripts/release/health-check.sh

# 独立校验 ZIP 的摘要、版本、结构、权限与安全边界
./scripts/release/validate-release.sh /absolute/path/nebula-vX.Y.Z-linux-x64.zip /absolute/path/SHA256SUMS

# 校验 ZIP、备份、迁移、原子切换；失败仅回退程序，不回退不可逆迁移
./scripts/release/upgrade.sh /absolute/path/nebula-vX.Y.Z-linux-x64.zip /absolute/path/SHA256SUMS

# 原子回退到上一程序版本或指定版本；不移动数据库、.env 或 Telegram workdir
./scripts/release/rollback.sh [X.Y.Z]
```

升级会把 `.env`、数据库和 Telegram Bot API workdir 保持在发行目录外。特别是 Bot API 的 `telegram-bot-api/data` 与历史 `file_id` 强绑定，严禁删除、重命名、迁移或由发行包覆盖。备份脚本根据 `DB_TYPE` 使用 PostgreSQL 逻辑备份或停止写入后的 SQLite 一致性备份：

```bash
./scripts/release/backup.sh
```


## 手工生产部署

```bash
# 前端
cd frontend
npm ci
npm run build

# 后端
cd ../backend
npm ci
npm run migration:run
npm run build
NODE_ENV=production npm run start:prod
```

生产模式由 NestJS 直接服务 `frontend/dist`，API 前缀为 `/api`，SPA 导航回退到 `index.html`。


## 部署注意事项

1. **持久化目录**：后端需要对工作目录下的 `tmp/` 有读写权限。该目录包含：
   - `tmp/Cache`：下载缓存
   - `tmp/uploads`：异步上传与分片临时文件
   - `tmp/thumbnails`：缩略图
   - `tmp/logs`：应用日志
2. **反向代理**：正确设置 `X-Forwarded-For` 和 `X-Forwarded-Proto`，并匹配 `TRUST_PROXY_HOPS`。Node 必须监听 `127.0.0.1`（`.env.example` 默认值），由反向代理暴露公网。
3. **大文件**：提高代理请求体限制和读写超时；下载链路应关闭不必要的代理缓冲并透传 Range 请求。
4. **HTTPS**：设置 `SECURE_COOKIE=true`，配置明确的 `CORS_ORIGINS`，不要使用通配符。若 TLS 在反向代理终止，必须同时设置 `TRUST_PROXY_HOPS`（使后端识别 `X-Forwarded-Proto: https`）或显式 `SECURE_COOKIE=true`，否则会话 Cookie 将缺少 `Secure` 标志。启动预检会对生产环境下的不安全组合发出明确告警（见下）。
5. **迁移**：生产环境保持 `DB_SYNCHRONIZE=false`，部署前运行 `npm run migration:run`。
6. **多实例：当前版本不支持**。本版本必须**单后端实例**部署（PostgreSQL + Redis + Telegram Bot API 可共享，但后端进程只能有一个）。原因是核心链路上仍有进程内内存态，多实例会直接导致功能异常：
   - 分片上传会话（`chunk-upload.service.ts` 的 `sessions`）：实例 A 创建的会话分片落到实例 B 会 `session not found`，大文件分片上传**随机失败**；
   - 缓存冷回源 single-flight（`cache-session-coordinator.ts` 的 `buildSessions`/`spoolSessions`）：多实例会重复向 Telegram 回源同一文件、重复写盘，去重失效；
   - 上传任务态（`upload-job.service.ts` 的 `jobs`）与合并并发信号量（`mergeSemaphorePerUser`）：进程重启即丢失、跨实例不共享；
   - 缩略图构建去重（`thumbnail.service.ts` 的 `thumbnailBuilds`）及其他进程内 Map；
   - 文件缓存 `tmp/Cache`、缩略图 `tmp/thumbnails` 与冷回源 spool 均为**实例本地磁盘**。

   `FILE_CACHE_NO_CACHE_MODE=true` 可跳过磁盘缓存，但**不能**解决上述会话/任务/单飞的内存态问题。需要多实例前必须先完成 Redis 外置专项（把分片上传会话、上传任务态、缓存冷回源 single-flight 与缩略图构建去重外置到 Redis 等共享存储）。若误配多实例，启动预检会输出高可见度错误（`CLUSTER_MODE` 相关校验）。
7. **优雅退出**：应用已启用 Nest shutdown hooks；进程管理器应发送可处理的终止信号并给予日志 flush 时间。

HTTP 服务器参数：活动连接空闲超时默认 `180` 秒（`HTTP_IDLE_TIMEOUT_SECONDS`，需大于缓存空闲超时且小于外层 Nginx `proxy_read_timeout`）、Keep-Alive 65 秒、请求头超时 66 秒；上传端点另行禁用请求超时。


