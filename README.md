# 星云盘

基于 NestJS、Vue 3、TypeORM、Redis 与 Telegram Bot API 的文件分发与网盘系统。元数据数据库默认使用 PostgreSQL，也正式支持显式 opt-in 的 SQLite 单机部署。

文件本体存放在 Telegram：上传与下载全部由后端代理，浏览器始终接触不到 Bot Token 与原始文件地址；仓库同时包含一个二次开发的 Telegram Bot API C++ fork（`telegram-bot-api/`），它提供流式文件端点，把冷文件的首字节等待从「整个文件下载完」降到「第一块到达」。

---

## 快速开始（Docker Compose，推荐）

**前置**：Docker 24+ / Compose v2；一个 Telegram Bot Token；一个用于存文件的私有群或频道 ID。不需要在宿主机装 Node、PostgreSQL 或 Redis。

```bash
git clone https://github.com/jacob-bytes/nebula.git && cd nebula
cp docker/env.example .env
# 编辑 .env，至少填下面四项
docker compose up -d --build
```

`.env` 中**必须**修改的项：

| 变量 | 说明 |
|---|---|
| `JWT_SECRET` | 至少 32 字符的随机值：`openssl rand -hex 32`。占位值/低熵值会被启动校验拒绝 |
| `POSTGRES_PASSWORD` | 数据库密码（仅容器内网使用） |
| `TELEGRAM_BOT_TOKEN` | 找 [@BotFather](https://t.me/BotFather) 创建，格式 `<bot_id>:<token>` |
| `TELEGRAM_CHAT_ID` | 存储文件的群/频道，形如 `-1001234567890`（见下方「Telegram 侧准备」） |

建议同时把 `APP_URL` 与 `CORS_ORIGINS` 改成本站真实地址（分享链接、邮件里的绝对地址由它们拼出）。

没准备好 Telegram 参数时容器会**启动失败并打印缺失项**（这是有意的 fail-closed，避免跑起来却传不了文件）。

**创建第一个管理员**：打开 `http://127.0.0.1:3000`，注册的第一个账号会自动成为 `super_admin`——该规则仅在 `users` 表为空时生效（已排除软删用户），此后注册默认关闭（`REGISTRATION_ENABLED=false`）。

**验证部署**：

```bash
docker compose ps              # app 应为 healthy
curl -s localhost:3000/api/health
docker compose logs -f app     # 看迁移与启动日志
```

> 容器端口默认只绑 `127.0.0.1:3000`。需要公网访问时，在前面加 Caddy/nginx 终止 TLS 再反代，不要把 Node 直接暴露到公网。

---

## 其他部署方式

### 裸机部署（Linux，不用容器）

**前置**：Node.js 22、PostgreSQL 14+、Redis 7；若要自建本地 Bot API，还需 CMake 与 C++ 工具链（见 `telegram-bot-api/README.md`）。

```bash
# 1. 构建
cd backend  && npm ci && npm run build
cd ../frontend && npm ci && npm run build
cd ../backend

# 2. 迁移（必须先于启动）
npx typeorm migration:run -d dist/database/data-source.js

# 3. 启动
APP_HOST=0.0.0.0 node dist/main.js
```

生产环境更推荐使用打包发行版（内嵌 Node 运行时、`start.sh`、健康检查与升级/回退脚本）：

```bash
bash scripts/build-linux-x64-release.sh   # 在 Linux x64 上执行
```

详见 [docs/deployment.md](docs/deployment.md)。

### 本地开发

```bash
cd backend  && npm run start:dev     # 默认 3000 端口
cd frontend && npm run dev           # /api 代理到 localhost:3000
```

前端代理目标可用 `VITE_API_PROXY_TARGET` 覆盖。数据库可用 SQLite 免安装：`DB_TYPE=sqlite DB_DATABASE=./data/nebula.sqlite`。

---

## 必填配置与四个常见坑

完整配置项见 [docs/configuration.md](docs/configuration.md)，以下是启动会**硬性校验**的部分：

| 变量 | 必填条件 | 说明 |
|---|---|---|
| `JWT_SECRET` | 始终 | ≥32 字符，禁止占位值与低熵值 |
| `DB_TYPE` | 始终 | `postgres`（默认）或 `sqlite` |
| `DB_HOST` / `DB_PORT` / `DB_USERNAME` / `DB_PASSWORD` | PostgreSQL | SQLite 模式下忽略 |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | 未启用账号池时 | 账号池启用后改由池内账号提供 |
| `CORS_ORIGINS` 或 `FRONTEND_URL` | 生产环境 | 缺失会直接启动失败，禁止用默认值 |
| `APP_URL` | 建议 | 分享链接与邮件的绝对地址来源 |

四个最容易踩的坑：

1. **`APP_HOST` 默认是 `127.0.0.1`**。容器里或需要远程访问时必须显式设为 `0.0.0.0`，否则只有本机能连。
2. **HTTPS 下 Cookie 不生效**：要么设 `SECURE_COOKIE=true`，要么设 `TRUST_PROXY_HOPS=<反代层数>` 让后端正确识别 `X-Forwarded-Proto`；两项都不配时启动会打印预检警告。
3. **迁移不会被自动执行（裸机）**：容器由 entrypoint 负责，裸机必须手动 `migration:run`，或显式设 `DB_MIGRATIONS_RUN=true` 让应用启动时执行。**升级前先备份数据库。**
4. **磁盘要按并发预留**：下载缓存与 Bot API workdir 可能落在同一块盘上，`tmp/Cache` 与 `telegram-bot-api/workdir` 会把同一分区写满。默认并发 8 时建议 ≥64 GiB 可用空间。

---

## Telegram 侧准备

1. **创建 Bot**：找 [@BotFather](https://t.me/BotFather) 发 `/newbot`，拿到 `<bot_id>:<token>`。
2. **准备存储位置**：新建一个**私有**群或频道，把 Bot 拉进去并授予「发送消息」权限；用 `getUpdates` 或第三方工具取到 `chat_id`（超级群/频道是 `-100` 开头）。Bot 不在群里或没有发言权限时，上传会在运行期失败。
3. **大文件（可选）**：官方 `api.telegram.org` 对下载有 20MB 上限。要传更大文件，需自建本地 Bot API（仓库自带 fork）：
   - 需要从 [my.telegram.org](https://my.telegram.org) 申请 `API_ID` / `API_HASH`（这不是 Bot Token）；
   - 以 `--local` 运行，`--enable-file-streaming` 打开流式端点；
   - 然后设置 `TELEGRAM_API_BASE` 与 `TELEGRAM_LOCAL_FILE_DIR`；
   - **workdir 必须持久化**，删掉它会让历史 `file_id` 失效；本地模式建议 2GB+ 内存并预留与文件同量级的磁盘。

   细节见 [docs/telegram.md](docs/telegram.md) 与 [telegram-bot-api/流式文件端点调用指南.md](telegram-bot-api/流式文件端点调用指南.md)。
4. **多账号池（可选）**：需要多 Bot 加权回源、镜像备份或副本扩散时启用，配置见 [docs/configuration.md](docs/configuration.md) 的「Bot 账号池」一节。

---

## 排障速查

| 现象 | 原因 | 处理 |
|---|---|---|
| 启动报 `JWT_SECRET 未设置 / 长度不足 / 疑似占位值` | 用了示例值或太短 | `openssl rand -hex 32` 重新生成 |
| 启动报 `CORS_ORIGINS 或 FRONTEND_URL 环境变量未配置` | 生产环境强制要求 | 填实际域名（与访问地址同源） |
| 启动报 `TELEGRAM_BOT_TOKEN 未设置` / 格式错误 | .env 里还是空值，或不是 `<id>:<token>` 形式 | 填 @BotFather 给的 token |
| 启动卡在数据库连接 | 容器还没 healthy，或 DB_* 指错 | `docker compose ps` 看 postgres 状态；核对 DB_HOST/PORT |
| 登录成功但立刻掉登录态 | 反代没转发 `X-Forwarded-Proto`，或 `SECURE_COOKIE` 配错 | 配 `TRUST_PROXY_HOPS`，HTTPS 下设 `SECURE_COOKIE=true` |
| 上传报找不到 chat / 无权限 | Bot 不在群里，或 `chat_id` 写错 | 拉 Bot 进群并给发言权限，核对 `-100` 前缀 |
| 大文件上传/下载失败 | 官方 API 有体积上限 | 部署本地 Bot API 并设置 `TELEGRAM_API_BASE` |
| 升级后旧文件下载 404 | Bot API workdir 被删除或迁移 | 恢复 workdir；`file_id` 与 workdir 强绑定，不可重建 |
| SQLite 模式有文件时列表 500 | v0.8.1 之前缺少 `file_tags` 表 | 升级到 ≥0.8.1 并执行迁移 |
| 磁盘被写满 | 缓存与 workdir 同卷、并发过高 | 调低并发 / 提高水位阈值，见 [docs/download-and-cache.md](docs/download-and-cache.md) |

---

## 核心能力

- **用户与权限**：邮箱注册、验证码与密码重置；JWT（HttpOnly Cookie）；`super_admin` / `admin` / `user` 三级角色；频率限制与临时封禁；API 密钥（`X-API-Key`）只能管理关联账号资源
- **文件与文件夹**：闭包表文件夹树（创建 / 重命名 / 移动 / 软删除 / 恢复）；标签与多标签 AND 筛选；卡片与列表双视图、搜索与无限滚动；同步 / 异步 / 分片上传；类型白黑名单与动态大小限制；7 天删除冷静期；图片缩略图
- **下载与缓存**：后端代理下载；本地缓存上限 / 最低剩余空间 / TTL 可在后台热更新；冷文件经实时流端点边下载边构建缓存，同一文件全局只有一个上游回源；单区间 Range 与断点续传；磁盘配额与排队，以及可观测排队的「两阶段下载任务」
- **分享**：独立 `ShareLink` 模型，同一文件或文件夹可有多条分享；密码 / 有效期 / 最大访问次数；严格密码模式；SPA 分享页 `/s/:token` 支持文件夹层级浏览
- **Telegram Bot 文件直链**：在 Bot 私聊发送 `document` 换取带有效期的匿名直链；按日限额与白名单；复用站内同一套缓存 / Range 链路
- **账号池与副本扩散**：多 Bot 账号加权选号回源；主群锚点 + 用户账号服务端转发（字节二次传输恒为 0）；镜像任务持久化、幂等、可重试
- **上传去重**：同一用户重复上传相同内容（sha256 一致）时复用已有 `file_id`，不重复占用 Telegram 上行带宽
- **存储配额**：全局默认 + 用户级上限，用量按 `files` 表实时汇总，超限在上传入口即拒绝；后台可按用户设置（继承 / 自定义 / 不限）
- **视频悬停预览**：鼠标停在视频行缩略图上即浮出小播放器，播原文件前几秒（触屏 / 省流量 / 减少动效时不请求）
- **分享预览卡**：分享页由服务端注入 Open Graph 标签，链接发到聊天软件里显示标题、大小，
  并按文件类型给出对应封面（图片/视频/音频/压缩包/文档）
- **管理与可观测性**：全站统计与自定义仪表盘；用户与全站文件管理；IP 封禁、攻击检测与 WebSocket 告警；访问日志、带宽 / 来源 UA / 活跃度分析；操作审计与 CSV / JSON 导出

## 技术栈

| 层级 | 技术 |
|---|---|
| 后端 | NestJS 11、TypeScript、TypeORM 0.3 |
| 前端 | Vue 3.5、TypeScript、Vite 6、TDesign Vue Next |
| 数据库 | PostgreSQL 14+（默认）/ SQLite 3（单机显式 opt-in） |
| 队列 | Bull 4、Redis |
| 文件存储 | Telegram Bot API / 二次开发本地 Bot API；可选 S3 兼容对象存储（读路径） |
| 认证 | Passport JWT、bcryptjs、HttpOnly Cookie |
| 邮件 | Nodemailer、SMTP |
| 实时通信 | Socket.IO |
| 图表 | ECharts 6 |
| 图片处理 | sharp |
| 状态与路由 | Pinia、Vue Router 4 |

> 设计体系为 shadcn 语义 token（zinc 中性色 + blue 主色）双主题，可在 `/admin/design-system`（仅超管）查看**可交互**的规范页：色板与对比度为运行时计算值。

> **最低配置**：2 核 CPU、4 GB 内存；磁盘可用空间 ≥ 最大并发数 × 4 GiB × 2（默认并发 8 时约 64 GiB）。详见 [docs/deployment.md](docs/deployment.md)。

## 文档

| 文档 | 内容 |
|---|---|
| [docs/deployment-docker.md](docs/deployment-docker.md) | Docker Compose 部署：一键启动、服务组成、迁移策略、备份与升级 |
| [docs/deployment.md](docs/deployment.md) | 裸机部署与运维：环境要求、Linux x64 预编译发行版、升级与回退、部署注意事项 |
| [docs/configuration.md](docs/configuration.md) | 环境变量与配置全表：数据库、应用与认证、SMTP、Redis、Telegram、账号池、镜像备份、副本扩散 |
| [docs/features.md](docs/features.md) | 核心能力详解：用户与权限、文件与文件夹、分享、管理与可观测性、上传模式 |
| [docs/download-and-cache.md](docs/download-and-cache.md) | 下载与缓存：磁盘配额与排队、回源预算与内存治理、超时分层、反向代理要求 |
| [docs/telegram.md](docs/telegram.md) | Telegram 集成：Bot 文件直链、文件引用完整性、workdir 持久性、僵尸上传恢复 |
| [docs/storage.md](docs/storage.md) | 存储抽象：StorageBackend 端口、S3 读后端、`files` 存储定位字段与切换步骤 |
| [docs/api-routes.md](docs/api-routes.md) | API 路由清单（公开 / 登录用户 / 管理员） |
| [docs/API.md](docs/API.md) | API Key 编程调用：认证、文件 / 文件夹 / 分享接口与三种下载链接模式 |
| [docs/openapi.json](docs/openapi.json) | OpenAPI 3 快照（服务运行时可访问 `/api/docs` 交互式文档） |
| [docs/development.md](docs/development.md) | 项目结构与常用命令 |
| [docs/security.md](docs/security.md) | 安全说明 |
| [frontend/STYLE_GUIDE.md](frontend/STYLE_GUIDE.md) | 前端样式规范（token、双主题、禁用项） |

## 关于本仓库

本仓库是 [lappland22233/tgtc](https://github.com/lappland22233/tgtc) v1.6.3 的二次开发分支，自 v0.1.0 起独立演进，**不再同步上游**。

相对上游的主要改动：

- **品牌独立**：站点名、API Key 前缀（`nebula_…`）、业务错误码响应头、SQLite 默认文件名、systemd 单元与安装路径统一为 `nebula` / 「星云盘」。
- **移除应用内自更新**：删除后端 `update` 模块（GitHub Release 拉取、GPG 验签、systemd oneshot 派发）、后台「系统更新」页面与 polkit 规则。升级改为运维执行 `scripts/release/upgrade.sh`。
- **新增能力**：内容去重、用户存储配额、存储抽象（S3 读路径）、上传趋势、可交互设计规范页。
- **视觉体系**：迁移到 shadcn 语义 token（zinc + blue），双主题、骨架屏、动效降级。

品牌是单一事实源：改 `brand.json` 后执行

```bash
node scripts/rename-brand.mjs                          # 按 brand.json 重新生成前后端常量
node scripts/rename-brand.mjs myslug 我的网盘 MyPan     # 全仓改名（包名、单元名、路径）
```

许可证为 [GPL-3.0](LICENSE)，上游版权与许可声明必须保留，见 [NOTICE](NOTICE)。若以二进制或镜像形式对外分发，须同时提供对应源码。`telegram-bot-api/` 为 Boost 1.0 许可，可独立商用。

## 发版流程

版本号唯一来源是 `VERSION`，必须与前后端 `package.json`、两份 lockfile 根包版本一致
（`bash scripts/release/check-version.sh` 会校验）。

```bash
# 1. 改版本号（VERSION + 四个清单 + 两份 lockfile）
# 2. 在 CHANGELOG.md 顶部加一节：## [x.y.z] - YYYY-MM-DD
# 3. 提交并打 tag
git tag -a v0.16.0 -m "星云盘 v0.16.0"
git push origin main --tags
```

推送 tag 后，`Release notes` 工作流会用 `GITHUB_TOKEN` **自动创建 GitHub Release**，
说明直接取自 `CHANGELOG.md` 对应小节，不需要任何 secret。历史 tag 可在
Actions → Release notes → Run workflow（勾选 `backfill`）一次性补齐。

需要**可下载的发行包**（Linux x64 ZIP）时另走 `Release` 工作流（手动触发，勾选 `publish`）：
它会构建、**用私钥签名 SHA256SUMS**、再上传资产。签名链路是：

```
CI secret(RELEASE_SIGNING_KEY, 私钥)  ──签名──▶  SHA256SUMS.sig
                                          ▲
scripts/release/update-public-key.pem ──验签──┘   （部署端同款：upgrade.sh / validate-release.sh）
```

### 配置签名密钥（一次性）

仓库已内置一对可用的密钥（公钥已提交）。**私钥在本仓库工作区的
`.secrets/release-signing-key.pem`（已在 `.gitignore` 中）**，把它填进 GitHub：

1. 打开仓库 **Settings → Secrets and variables → Actions → New repository secret**
2. Name 填 **`RELEASE_SIGNING_KEY`**（大小写必须完全一致）
3. Secret 一栏**整段粘贴**私钥内容，包括首尾的
   `-----BEGIN PRIVATE KEY-----` / `-----END PRIVATE KEY-----`
4. 保存后执行 `rm -rf .secrets`（或把文件转移到离线密码管理器）

GitHub 保存后不可再读取，只可覆盖；要确认是否配对，跑一次 `Release` 工作流即可——
`sign-release.sh` 会立刻用内置公钥自检，不匹配会丢弃签名并失败。

> 想用自己生成的密钥：`openssl genrsa -out key.pem 3072` 后
> `openssl rsa -in key.pem -pubout -out scripts/release/update-public-key.pem`，
> 提交新公钥并更新 secret。**换密钥后旧发行包的签名将无法验证**。

### 轮换 / 泄露处理

私钥泄露时：生成新密钥对 → 提交新公钥 → 覆盖 secret → 重发尚未被下载的版本。
已发布的旧包签名无法用新公钥验证，需在 Release 说明里注明。

配置完成后可把 `.github/workflows/release.yml` 的触发方式改回 `push: tags`。

## 许可证

GNU General Public License v3.0
