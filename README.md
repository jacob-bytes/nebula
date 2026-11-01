# 星云盘

基于 NestJS、Vue 3、TypeORM、Redis 与 Telegram Bot API 的文件分发与网盘系统。
元数据存数据库（PostgreSQL 或 SQLite），**文件本体存在 Telegram**：上传下载全部由后端代理，
浏览器始终接触不到 Bot Token 与原始文件地址。

仓库内含一个二次开发的 Telegram Bot API C++ fork（`telegram-bot-api/`），提供流式文件端点，
把冷文件的首字节等待从「整个文件下载完」降到「第一块到达」。

---

## 1. 快速开始

> **1.1–1.4 是四种并列的方式，任选其一即可，不要依次执行。**
>
> | 场景 | 选哪个 |
> |---|---|
> | 有 Docker，想最快跑起来 | 1.1 |
> | 裸机 Linux、希望一条命令装好（含 systemd） | 1.2 |
> | 自己控制 Node/数据库运行时，或需要定制构建 | 1.3 |
> | 改代码、调试前端 | 1.4（仅开发用，不做反向代理、不装服务） |

### 1.1 Docker Compose（推荐）

```bash
git clone https://github.com/jacob-bytes/nebula.git && cd nebula
cp docker/env.example .env      # 至少填下表四项
docker compose up -d --build
curl -s localhost:3000/api/health
```

| 变量 | 说明 |
|---|---|
| `JWT_SECRET` | `openssl rand -hex 32`；占位值/低熵值会被启动校验拒绝 |
| `POSTGRES_PASSWORD` | 数据库密码（仅容器内网使用） |
| `TELEGRAM_BOT_TOKEN` | [@BotFather](https://t.me/BotFather) 获取，格式 `<bot_id>:<token>` |
| `TELEGRAM_CHAT_ID` | 存文件的私有群/频道 ID，形如 `-1001234567890` |

建议同时把 `APP_URL` / `CORS_ORIGINS` 改成真实地址（分享链接与邮件里的绝对地址由它们拼出）。
容器端口默认只绑 `127.0.0.1:3000`；公网访问请在前面加 Caddy/nginx 终止 TLS。

### 1.2 一键安装（Linux / systemd）

```bash
curl -fsSL https://raw.githubusercontent.com/jacob-bytes/nebula/main/scripts/install.sh | sudo bash
```

下载发行包 → 验签 → 解压到 `/opt/nebula/releases/<版本>` → 切换 `current` → 调 `start.sh`。
默认 SQLite（免装数据库），不接管反向代理与证书。

三种配置模式：

| 方式 | 命令 | 适用 |
|---|---|---|
| 交互式 | `... \| sudo bash` | 首次安装，逐项提问 |
| 无人值守 | `sudo NEBULA_TELEGRAM_BOT_TOKEN=... bash -s -- --yes` | 自动化/批量部署 |
| 零提问 + 网页向导 | `sudo bash -s -- --defer-config` | 装完打开 `/setup` 在浏览器里配置 |

详见 [docs/deployment.md](docs/deployment.md)。

### 1.3 源码运行

```bash
cd backend  && npm ci && npm run build
cd ../frontend && npm ci && npm run build
cd ../backend && npx typeorm migration:run -d dist/database/data-source.js
APP_HOST=0.0.0.0 node dist/main.js
```

### 1.4 本地开发

```bash
cd backend  && npm run start:dev     # 默认 3000 端口
cd frontend && npm run dev           # /api 代理到 localhost:3000
```

SQLite 免安装：`DB_TYPE=sqlite DB_DATABASE=./data/nebula.sqlite`。

---

## 2. 首次初始化

- **Docker / 交互式安装**：打开站点注册第一个账号，自动成为 `super_admin`
  （仅当 `users` 表为空时生效，此后注册默认关闭）。
- **`--defer-config` 安装**：终端会打印一次性安装令牌，打开 `/setup` 按三步完成
  （站点 → Telegram，可发测试消息验证 → 管理员）。令牌同时存在 `<安装根>/.setup-token`，
  完成后自动删除；**未初始化的实例暴露公网时任何人可抢先设置管理员，因此令牌是强制项**。

完成后服务会以新配置重启，刷新页面即可登录。

---

## 3. 必填配置

完整配置见 [docs/configuration.md](docs/configuration.md)，以下是启动会硬性校验的部分：

| 变量 | 必填条件 | 说明 |
|---|---|---|
| `JWT_SECRET` | 始终 | ≥32 字符，禁止占位值与低熵值 |
| `DB_TYPE` | 始终 | `postgres`（默认）或 `sqlite` |
| `DB_HOST` / `DB_PORT` / `DB_USERNAME` / `DB_PASSWORD` | PostgreSQL 时 | SQLite 模式忽略 |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | 未启用账号池时 | 向导模式下可缺省 |
| `CORS_ORIGINS` 或 `FRONTEND_URL` | 生产环境 | 缺失直接启动失败 |

四个常见坑：

1. **`APP_HOST` 默认 `127.0.0.1`**：容器或远程访问必须显式设 `0.0.0.0`。
2. **HTTPS 下 Cookie 不生效**：设 `SECURE_COOKIE=true`，或设 `TRUST_PROXY_HOPS=<反代层数>`。
3. **裸机不会自动迁移**：手动 `migration:run`，或设 `DB_MIGRATIONS_RUN=true`。升级前先备份。
4. **磁盘按并发预留**：缓存与 Bot API workdir 可能同卷，默认并发 8 时建议 ≥64 GiB 可用空间。

---

## 4. Telegram 侧准备

1. **创建 Bot**：[@BotFather](https://t.me/BotFather) 发 `/newbot`，拿到 `<bot_id>:<token>`。
2. **存储位置**：建私有群/频道 → 拉 Bot 进群并授予发言权限 → 取 `chat_id`（超级群/频道以 `-100` 开头）。
3. **大文件（可选）**：官方 API 下载上限 20MB。更大文件需自建本地 Bot API（仓库自带 fork）：
   申请 `API_ID`/`API_HASH`（[my.telegram.org](https://my.telegram.org)，不是 Bot Token），
   以 `--local --enable-file-streaming` 运行，再设 `TELEGRAM_API_BASE` 与 `TELEGRAM_LOCAL_FILE_DIR`。
   **workdir 必须持久化**——删掉它会让历史 `file_id` 全部失效。
   见 [docs/telegram.md](docs/telegram.md)。
4. **账号池（可选）**：多 Bot 加权回源、镜像备份与副本扩散，见 [docs/configuration.md](docs/configuration.md)。

---

## 5. 功能

- **用户与权限**：邮箱注册 / 验证码 / 密码重置；JWT（HttpOnly Cookie）；三级角色；限流与封禁；API 密钥
- **文件与文件夹**：闭包表文件夹树、标签与 AND 筛选、卡片/列表双视图、同步/异步/分片上传、7 天删除冷静期
- **下载与缓存**：后端代理、可热更新的缓存上限/TTL、单上游回源、Range 断点续传、磁盘配额与排队
- **分享**：独立 `ShareLink`、密码/有效期/次数限制、文件夹层级浏览、服务端注入 Open Graph 卡片（按类型出封面）
- **视频**：上传后 ffmpeg 抽帧生成封面；列表悬停浮出小播放器，播原文件前几秒
- **存储**：内容去重（同用户 sha256 命中复用）、用户级配额（继承/自定义/不限）、S3 兼容对象存储（读路径）
- **管理与观测**：统计仪表盘、文件/用户管理、IP 封禁与告警、访问日志与审计导出、可交互设计规范页（`/admin/design-system`）

---

## 6. 技术栈

| 层级 | 技术 |
|---|---|
| 后端 | NestJS 11、TypeScript、TypeORM 0.3 |
| 前端 | Vue 3.5、Vite 6、TDesign Vue Next、Pinia |
| 数据库 | PostgreSQL 14+ / SQLite 3 |
| 队列 | Bull 4、Redis |
| 存储 | Telegram Bot API / 本地 Bot API（fork）/ S3 兼容（读） |
| 其他 | Socket.IO、ECharts 6、sharp、Nodemailer |

**最低配置**：2 核 CPU、4 GB 内存；磁盘 ≥ 并发数 × 4 GiB × 2（默认并发 8 时约 64 GiB）。

---

## 7. 发版

版本号唯一来源是 `VERSION`，必须与前后端 `package.json` 及两份 lockfile 一致
（`bash scripts/release/check-version.sh` 校验）。

```bash
# 1. 改版本号  2. 在 CHANGELOG.md 顶部加一节  3. 提交并打 tag
git tag -a v0.24.0 -m "星云盘 v0.24.0" && git push origin main --tags
```

推 tag 后 `Release notes` 工作流用 `GITHUB_TOKEN` 自动创建 GitHub Release（说明取自
`CHANGELOG.md`）。需要可下载的 Linux x64 发行包时手动跑 `Release` 工作流（勾选 `publish`），
它构建、签名并上传资产——签名密钥的配置见 [docs/deployment.md](docs/deployment.md) 的
「发行签名密钥」。

---

## 8. 文档

| 文档 | 内容 |
|---|---|
| [docs/deployment.md](docs/deployment.md) | 安装、升级与回退、签名密钥、ffmpeg 依赖、部署注意事项 |
| [docs/deployment-docker.md](docs/deployment-docker.md) | Docker Compose：服务组成、迁移、备份、本地 Bot API |
| [docs/configuration.md](docs/configuration.md) | 环境变量全表 |
| [docs/features.md](docs/features.md) | 能力详解（含上传模式） |
| [docs/download-and-cache.md](docs/download-and-cache.md) | 下载与缓存：配额、排队、超时分层、反向代理要求 |
| [docs/telegram.md](docs/telegram.md) | Telegram 集成：直链、workdir、僵尸上传恢复 |
| [docs/storage.md](docs/storage.md) | 存储抽象与 S3 读后端 |
| [docs/API.md](docs/API.md) / [docs/openapi.json](docs/openapi.json) | API Key 调用说明 / OpenAPI 快照（`/api/docs`） |
| [docs/development.md](docs/development.md) | 项目结构与常用命令 |
| [frontend/STYLE_GUIDE.md](frontend/STYLE_GUIDE.md) | 前端样式规范 |

---

## 9. 关于与许可

本仓库是 [lappland22233/tgtc](https://github.com/lappland22233/tgtc) 的二次开发分支，自 v0.1.0 起
独立演进、不再同步上游：品牌、界面与部署链路均已重做，并移除了应用内自更新（改用
`scripts/release/upgrade.sh`）。品牌是单一事实源，改 `brand.json` 后跑 `node scripts/rename-brand.mjs`。

许可证 [GPL-3.0](LICENSE)，上游版权声明见 [NOTICE](NOTICE)；以二进制或镜像对外分发须同时提供源码。
`telegram-bot-api/` 为 Boost 1.0 许可，可独立商用。
