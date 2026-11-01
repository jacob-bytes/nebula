# 变更日志

本文件记录本仓库（Nebula / 星云盘）自上游分叉后的自有变更。
上游 1.6.3 及更早的历史不再维护于此。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [0.20.0] - 2026-11-01

分享卡封面按文件类型区分。

### 变更

- **OG 封面按类型生成**：图片 / 视频 / 音频 / 压缩包 / 文档 / 默认共 6 张 1200×630 封面
  （`frontend/public/og/`），分享页按 `mimeType` 选择，替代原来所有分享共用一张品牌图。
- 生成脚本 `scripts/assets/gen-og-covers.py`（PIL，可重跑；含中文字体回退链）。
- `share-og.ts` 新增 `ogCoverKindForMime()` 纯函数 + 12 条映射用例
  （含空/未知 MIME 回退 default）。
- 密码保护、已失效、token 不存在的分享统一用 `default` 封面。

### 说明

- 没有采用「真实文件缩略图作为 og:image」：缩略图链路依赖回源与 media ticket，
  爬虫抓取时可能 404，反而让分享卡片变空白；类型封面是确定性的，且能体现内容类别。

### 验证

- 三种分享实测：`video/mp4 → /og/video.png`、`application/pdf → /og/doc.png`、
  `application/zip → /og/archive.png`；密码保护 → `/og/default.png`。
- 6 张封面 HTTP 200（27KB 左右）；E2E 5 条用例通过；前端 392、后端 1627 通过。

## [0.19.0] - 2026-11-01

修复并发冷下载的真实竞态；配额批量设置与用量预警。

### 修复

- **并发冷下载偶发 `ENOENT`**（`file-cache.service.spec.ts` 全量跑约 1/3 概率失败）：
  根因不是测试脆弱，而是产品代码的真实竞态——leader 先把临时文件 `rename` 为正式缓存、
  再置 `session.completed`，而 follower 的 fallback 路径只在 `completed` 为真时才指向
  正式缓存。窗口期内临时路径已消失、`completed` 仍为 false，fallback 返回 null → 直接抛
  `ENOENT`。改为 fallback 恒指向正式缓存路径（仅在首选路径打开失败时才会用到）。
  验证：单用例连跑 20 次全过；全量套件连跑 3 次全过。

### 新增

- **配额批量设置**：用户列表加入多选列与「批量设置配额」入口，一次请求应用同一配额
  （后端 ≤500 上限），成功后同步行状态并清空选择。
- **用量预警**：文件页在配额使用 ≥80% 时显示横幅（≥95% 转为危险色并提示无法继续上传），
  附「查看配额」入口；拉取失败不影响文件列表本身。
- `scripts/ops/selftest.sh`：备份/恢复自检，SQLite 路径可在任意平台跑（5/5 通过），
  PostgreSQL 路径在有 docker 时启动一次性容器验证。

### 说明

- `upgrade.sh` 整链回归未实现：`upgrade.sh` / `rollback.sh` / `validate-release.sh` 均调用
  `require_linux`，在 macOS 上无法执行，写出的用例只能盲跑 CI。替代方案是把演练步骤
  写进部署文档，由运维在 Linux 主机上执行。

## [0.18.1] - 2026-11-01

修复 CI 静态门禁：shellcheck SC2163。

### 修复

- `scripts/ops/{backup,restore}.sh` 里从 `.env` 导出变量的写法 `export "$line"` 触发
  shellcheck SC2163（"This does not export 'line'"）。改为 `export "${line?}"`——
  展开后仍是合法的 `KEY=VALUE` 赋值，同时消除告警。
  该告警来自 `--severity=warning` 门禁，会把整条 Release scripts 作业判失败。

## [0.18.0] - 2026-11-01

浏览器 E2E 与 OpenAPI 自动生成。

### 新增

- **Playwright 浏览器 E2E**（`frontend/e2e/`）：5 条主链路用例——未登录跳转、
  管理员登录进仪表盘、文件列表渲染种子数据、分享页展示与下载入口、
  分享页返回带 Open Graph 的服务端 HTML（并断言 og:title 只有一份）。
- **E2E 启动器** `scripts/e2e/serve.sh` + `scripts/e2e/seed.mjs`：一次性 SQLite 库、
  确定性测试数据（固定邮箱/密码/token），跑完即删，不碰开发数据。
- **CI 作业 `Browser E2E / Playwright`**：构建前后端 → 安装 Chromium → 跑用例，
  失败时上传 report 与 trace。
- **OpenAPI 自动生成**（`@nestjs/swagger`）：`/api/docs`（Swagger UI 与
  `/api/docs-json`），含 Cookie 与 API Key 两种安全方案；`OPENAPI_ENABLED=false` 可关闭。
  导出快照 `docs/openapi.json`（174 条路径）与结构守卫 `openapi-snapshot.spec.ts`。
- vitest 排除 `e2e/**`：Playwright 用例与 vitest 的 `*.spec.ts` 同名，不排除会在导入时报错。

### 修复

- `scripts/e2e/serve.sh` 的 `$PORT）` 触发 bash 变量名吞字符（本次第三次踩到，
  已由 `check-shell-var-braces.py` 门禁拦截并把 `scripts/e2e/*.sh` 纳入 CI 检查范围）。

### 验证

- `npx playwright test`：5 passed（9.9s，Chromium）。
- 前端 vitest 392 通过；后端 jest 1615 通过。
- `curl /api/docs-json` 返回 174 条路径、版本号与 package.json 一致。

## [0.17.0] - 2026-11-01

分享页 Open Graph 卡片 + 后台配额管理界面。

### 新增

- **分享页服务端 OG 注入**：`/s/:token` 是 SPA 路由，爬虫不执行 JS，此前分享链接在
  Telegram/微信里是一片白卡片。现在服务端按 token 查元数据并替换 `<title>` 与
  `og:*` 标签；密码保护与已失效的分享只给通用文案并加 `robots: noindex`，
  不泄露文件名。取不到数据时退回通用 HTML，探测有 1.5s 超时兜底。
- **OG 渲染器**（`share-og.ts`，纯函数）：HTML 属性全量转义（文件名是用户可控输入）、
  区域替换避免出现两份 og 标签、缺少 `</head>` 时原样返回。8 个单测覆盖。
- **分享卡封面** `frontend/public/og-cover.png`（1200×630）与 index.html 默认 OG 标签。
- **后台配额管理**：用户列表新增「存储配额」列（继承/不限/自定义）与配额对话框，
  显示已用/上限，支持三态切换与 GB 级自定义；`storageQuotaBytes` 加入后台列表 select。
- `frontend/src/api/quota.ts` 增加 `getUserQuota` / `setUserQuota` / `setUsersQuotaBatch`。

### 验证

- 实测三种 token：公开分享注入真实标题与 `og:image`（无重复标签）、密码分享注入
  通用文案 + noindex、不存在的 token 退回默认标签。
- 配额接口实测 GET/PUT 与列表字段一致（5GB → 10GB）；对话框截图复核。
- 前端 vitest 392 通过；后端 jest 1601 通过（`file-cache.service.spec.ts` 在并发满载时
  偶发超时，单跑与二次全量均通过）。

## [0.16.0] - 2026-11-01

交付与运维：本地 Bot API 进 Compose、多架构镜像、备份恢复、升级路径回归。

### 新增

- **compose 可选服务 `bot-api`（profile: botapi）** + `docker/bot-api.Dockerfile`：
  编译仓库内的 TDLib fork，以 `--local --enable-file-streaming` 运行，突破官方
  20MB 下载上限。与 app 共享 `botapi-workdir`（app 侧只读），workdir 持久化。
  不对外暴露端口，仅 compose 内网可达。
- **GHCR 多架构镜像**：`.github/workflows/publish-image.yml`（amd64+arm64，
  semver/edge/sha 标签，registry 构建缓存）；`.github/workflows/publish-bot-api-image.yml`
  手动发布 Bot API 镜像（编译耗时长，不跟随 push）。
- **`scripts/ops/backup.sh` / `restore.sh`**：支持直连与 `--compose` 两种形态；
  SQLite 用 `VACUUM INTO` + `PRAGMA integrity_check`，PostgreSQL 用 custom format
  `pg_dump`；快照含 `MANIFEST.txt`（版本/大小/sha256）与保留策略。
  恢复端校验 sha256、非空库需 `--force`、SQLite 原子替换。
- **升级路径回归** `backend/src/database/upgrade-migration.spec.ts`：跑完整迁移链 →
  插入数据 → `undoLastMigration()` 回到旧 schema → 再次迁移，断言数据完好、
  迁移记录一致、重复执行为空操作。
- **`scripts/ci/check-shell-var-braces.py`** 接入 CI 门禁：禁止 `$VAR` 紧跟非 ASCII
  字符（bash 会把它并入变量名，`set -u` 下直接失败）。

### 修复

- `backup.sh` 的保留策略改用 `while read` 而非 `mapfile`（macOS 自带 bash 3.2 无此命令）。
- 新增脚本中同类 `$VAR` 后接全角字符的问题 4 处一并修正。

### 验证

- SQLite 备份→删库→恢复：数据完整（用户行回来了）；覆盖保护与篡改检测按预期拒绝。
- 后端 `tsc --noEmit` 通过；jest 1593 passed / 0 failed（含新增升级用例）。

## [0.15.6] - 2026-11-01

修复发布流水线与 release-notes 工作流的同名冲突。

### 修复

- **`Release` 工作流发布步骤改为幂等**：`release-notes.yml` 会在 tag 推送时先建一个
  「只有说明」的 Release，而 `release.yml` 用 `gh release create`，同名时直接失败
  （实测：`a release with the same tag name already exists: v0.15.5`）。
  现在先 `gh release view` 探测：已存在则 `upload --clobber` 补传资产并 `edit` 更新说明，
  不存在才创建。
- `gh release edit --latest` 单独执行并容错：该参数在较旧 gh 上不存在，
  不应因此让整个发布失败。

### 说明

- 该次失败发生在**签名与发行包校验都通过之后**的发布步骤，说明签名密钥与
  `docs/release-notes` → `CHANGELOG` 的发行说明来源均已生效。

## [0.15.5] - 2026-11-01

配置发行签名链路：替换为自有密钥对，并补操作文档。

### 变更

- **`scripts/release/update-public-key.pem` 替换为自有公钥**（RSA-3072）。原文件是上游作者
  的公钥，用它无法验证我们的发行包——即使加了 secret 也会在 `sign-release.sh` 的自检处失败。
- 私钥生成在工作区 `.secrets/release-signing-key.pem`（`chmod 600`，已加入 `.gitignore`），
  需手工填入仓库 secret `RELEASE_SIGNING_KEY`，之后删除该文件或转存离线介质。

### 文档

- README「发版流程」补「配置签名密钥」与「轮换 / 泄露处理」：GitHub 入口路径、
  secret 名称大小写、整段 PEM 粘贴（含 BEGIN/END）、保存后不可读取、以及换密钥会让
  旧发行包签名失效。

### 验证

- 本地端到端：用新私钥签名 `SHA256SUMS` → 用入库公钥验签 **Verified OK**；
  篡改内容后验签失败（bad signature）。
- `sign-release.sh` 实际执行通过（含内置公钥自检）；`verify-key-override.test.sh` 4 项通过。

## [0.15.4] - 2026-11-01

补齐 GitHub Release 的自动化发布。

### 新增

- `.github/workflows/release-notes.yml`：tag 推送时用 `GITHUB_TOKEN` 创建 GitHub Release，
  说明取自 `CHANGELOG.md` 对应小节；已存在同名 Release 时跳过，避免覆盖后续由
  `release.yml` 产出的带制品正式发布。支持 `workflow_dispatch` 的 `backfill`
  为历史 tag 一次性补建。
- README「发版流程」：版本号唯一来源、CHANGELOG 小节要求、tag 推送后的自动化行为、
  以及需要可下载发行包时的签名密钥配置步骤。

### 背景

仓库此前有 19 个 tag 但 0 个 Release——`gh release create` 只存在于需要
`RELEASE_SIGNING_KEY` 的发布流水线里，缺少该 secret 时整条流水线不会走到发布步骤。

## [0.15.3] - 2026-11-01

修复 CI 红灯：shell 变量解析、发行说明来源、DI 守卫误判。

### 修复

- **shell 中 `$VAR` 紧跟中文/全角标点**：bash 在 UTF-8 locale 下会把该字符并入变量名，
  `set -u` 下直接报 `unbound variable` 并以错误码退出。`check-download-proxy.sh` 因此
  在 CI 失败；`upgrade.sh` / `start.sh` 等运行期脚本也有同类隐患（共 28 处），
  统一改为 `${VAR}` 花括号形式。
- **发行构建强制要求 `docs/release-notes/v<版本>.md`**：该目录在 v0.1.0 移除后，
  ZIP 打包与 Release 流水线必然失败。改为**从 `CHANGELOG.md` 抽取同版本小节**
  （单一事实源），保留旧路径作为回退，两者都缺失才失败。
- **DI token 静态守卫误判异常类**：`AccountUploadUnavailableError` 的构造函数参数没有
  类型标注，被规则判为「无法解析注入 token」，导致整个后端质量门禁失败。
  规则收敛为**只检查 class 上带装饰器（会被容器实例化）的类**，并新增「非 DI 类不参与
  判定但确实被解析到」的用例，避免退化成空扫。

### 变更

- **Release 工作流改为仅手动触发**：正式发布要求 `RELEASE_SIGNING_KEY` secret 与
  `scripts/release/update-public-key.pem` 配对，本仓库尚未配置自己的签名密钥，
  tag 推送触发的流水线会在签名步骤必然失败。配置密钥后可按需恢复 `push: tags`。

### 验证

- 后端 jest 1590 passed / 0 failed（含新增用例）；`gate:sqlite` 通过；
  覆盖率 65.91 / 54.17 / 61.06 / 67.36（阈值 60/45/55/60）。
- `scripts/release/tests` 三个套件在 Linux 语义下通过；`rollback-safe-flag` 在 macOS
  本地因 BSD `realpath` 不支持 `-e` 而失败，属本机环境差异，CI（Ubuntu）不受影响。

## [0.15.2] - 2026-11-01

仓库精简：删掉未使用的 516KB 图标精灵与生成的构建产物。

### 移除

- `frontend/public/fonts/tdesign-icons-sprite.js`（516 KB，随 `public/` 原样拷进 dist）：
  全仓零引用。通过 A/B 对照验证——带着它与删掉它渲染完全一致，
  `t-icon` 的字符串名走运行时解析，与该精灵无关。JS 产物总量 2570 KB → 2094 KB。
- `backend/dist-migrator/`（27 个文件，生成的编译产物）：仅由
  `npm run build:data-migrator` 产出，运行时不引用；已加入 `.gitignore`。
- `frontend/src/components/folder/FolderBreadcrumb.vue`：全仓零引用的死组件。
- `telegram-bot-api/build.html`：上游的构建指令生成页，与运行无关。
- 误提交的 `node_modules/.vite/vitest/.../results.json`（测试缓存）。

### 修复

- **首屏深色闪烁**：`public/critical.css` 无条件把底色设成 `#0a0e17`，
  而应用默认主题是浅色（`initTheme`：localStorage → prefers-color-scheme → light），
  浅色用户会先看到一帧深色再变白。改为浅色为默认 + `prefers-color-scheme: dark` 覆盖。
- **分享页「在线预览」缺图标**：`t-icon name="browse"` 未解析出图标（与精灵无关，
  A/B 已证明），改为内联 SVG，与项目其他图标写法一致。

### 说明

- `telegram-bot-api/td/`（1661 文件 / 32 MB）保留：它是该 fork 的核心价值（流式端点），
  且在 `.dockerignore` 中已排除，不影响应用镜像体积。

### 验证

- `vue-tsc` / `vite build` / `check:bundle` 通过；vitest 392 项通过。
- 图标渲染与首屏底色经截图 A/B 对照确认。

## [0.15.1] - 2026-11-01

README 重写：补齐从零部署路径。

### 文档

- 新增「快速开始（Docker Compose）」：四项必填变量、首个管理员如何产生
  （`users` 表为空时注册即 super_admin，此后默认关闭注册）、部署验证命令。
- 新增「其他部署方式」：裸机（构建 → 迁移 → 启动）与本地开发（Vite 代理说明）。
- 新增「必填配置与四个常见坑」：`APP_HOST` 默认 127.0.0.1、HTTPS 下
  `SECURE_COOKIE`/`TRUST_PROXY_HOPS`、裸机需手动迁移、磁盘按并发预留。
- 新增「Telegram 侧准备」：Bot Token、私有群/频道与 `chat_id`、20MB 上限与自建
  本地 Bot API 的取舍（含 workdir 必须持久化）。
- 新增「排障速查」表：启动校验失败、登录态丢失、上传权限、大文件、workdir 删除、
  SQLite `file_tags`（v0.8.1 前）、磁盘写满。
- 文档表补齐 docker/storage 两项；核心能力补充「上传去重」「存储配额」。

### 说明

- 所有相对链接已脚本校验无失效；必填项与 `docker/env.example`、
  `docker-compose.yml` 的变量插值逐项核对。
- 容器镜像未在本机构建验证（环境无 Docker），Docker 路径按仓库内既有 compose
  与 entrypoint 行为描述。

## [0.15.0] - 2026-11-01

新增可交互的设计规范页，把前几轮的视觉约定固化下来。

### 新增

- **`/admin/design-system`（仅超级管理员）**：
  - 色板：种子 / 语义 / 文字三组，**对比度为运行时实时计算**（从 `getComputedStyle`
    解析真实 token，兼容 `rgb()` 与 `color(srgb …)` 两种记法），切换主题自动重算；
  - ring 按 WCAG 1.4.11 的非文本阈值 3:1 判定，其余前景色按 4.5:1；
  - 字体阶梯、圆角与间距刻度；
  - 控件状态矩阵：按钮（主/次/危险/禁用 × 尺寸）、输入框（默认/禁用/错误）、
    标签、分段控件、骨架占位、空状态；
  - 「正误对照」四组（颜色 / 间距 / 空状态 / 破坏性操作）。
- 侧边栏「管理后台 → 设计规范」入口；`PAGE_ROLES` 同步登记。

### 修复

- **`--space-*` 令牌从未定义**：`PersistentMediaHost` 等组件引用 `var(--space-4)`
  却解析为空值，导致浮动播放器贴边而不是保留 16px 内边距。补齐 4/8/12/16/24/32/48 刻度。
- 规范页的「错误」输入框示例此前只有红色文案、边框仍是默认色，补上危险色边框与 focus 环。

### 文档

- `STYLE_GUIDE.md` 增加「可交互的规范页」一节，指向该路由并说明其权威性。

### 验证

- `vue-tsc` / `vite build` / `check:bundle` 通过；vitest 392 项通过。
- 浅色与暗色截图复核：令牌解析、对比度数值、控件状态矩阵。

## [0.14.0] - 2026-11-01

后台仪表盘栅格与嵌套卡片修正。

### 变更

- **6 张指标卡改为固定 3 列**（≤1024px 两列、≤640px 单列）。原来用
  `auto-fit minmax(200px,1fr)`，宽屏下会排成 5+1，第二行孤零零一张。
- **去掉卡片套卡片**：「我的文件统计」里的 3 个 `.stat-card` 改为竖分隔线分组的
  指标块（label + 数值），消除两层边框叠加的脏感。
- **指标卡补齐信息结构**：标签 + 右上角语义色图标 + 大数值 + 一句上下文说明
  （如「平均每文件 60.4 MB」「可在用户管理中解封」）。
- **空图表占位**：从一行「暂无访问数据」改为淡色占位柱 + 说明文案；
  占位柱用 `--border-default` 而非 `--muted`（后者在暗色下与卡片同色，几乎不可见）。
- 左右两卡改为按内容定高（`align-items: start`），不再被另一侧拉伸留白。

### 验证

- `vue-tsc` / `vite build` / `check:bundle` 通过；vitest 392 项通过。
- 浅色与暗色截图复核：3×2 栅格、分隔线指标、空图表占位。

## [0.13.0] - 2026-11-01

移动端操作收敛 + 公开分享页重做。

### 变更

- **移动端文件卡片**：5 个同权重文字按钮（复制/预览/下载/标签/删除）收敛为
  主操作「预览／下载」+ 溢出菜单（复制链接 / 管理标签 / 删除）。
  删除等破坏性操作不再与主操作抢位置，也降低了窄屏误触。
  按钮最小高度提到 40px，溢出菜单贴右。
- **公开分享页重做**：
  - 新增品牌行（徽标 + 站点名 + 「文件分享」），对外页面能看出是谁的服务；
  - 元信息从「·」串联的裸文本改为 chip 组（大小 / 类型 / 创建时间 / 到期时间）；
  - 主操作改为整宽「下载文件」，次操作「在线预览」降级为描边按钮；
  - 预览区改为品牌色柔光 + 居中文件标识（原来是一整条渐变带）；
  - 页脚加「由 星云盘 分享 · 请确认来源可信后再下载」；
  - 安全状态由彩色胶囊改为「圆点 + 文案」，减少颜色噪音。

### 修复

- 溢出菜单点击无效：`@click="moreHandler(file)"` 在 Vue 中只会调用并**丢弃返回值**，
  TDesign dropdown 的点击载荷根本传不进处理器。改为 `@click="handleMore($event, file)"`。
  该问题被单测捕获（菜单项点击后未派发 copy-link / tag-editor / delete）。

### 验证

- `vue-tsc` / `vite build` / `check:bundle` 通过；vitest 392 项全部通过
  （含重写的移动端动作契约用例：2 个按钮 + 3 个菜单项）。
- 截图复核：390px 移动端文件卡片、桌面与移动端分享页。

## [0.12.0] - 2026-11-01

图表与列表细节打磨，并适当放宽体积门禁。

### 变更

- **体积门禁放宽**：整体余量 5% → 8%，首屏关键资源 2% → 4%（仍保持更严）。
  理由是设计系统演进期会产生持续而可控的样式增长，5% 会导致每次改版都必须手工改基线，
  反而弱化「回退告警」的意义；8% 仍能拦住整包级回退（误引入全量 TDesign 样式通常是数十个百分点）。
- **图表 tooltip 增强**：同时展示日期、文件数量与总体积——只有数量无法区分
  「1 个 200MB 视频」和「1 个 80KB 文档」；点击轴改为 shadow 指示器。
- **图表主色跟随主题**：暗色用 blue-400，并监听 `data-theme` 变化重绘
  （ECharts 不会跟随 CSS 变量变色）。
- **峰值提示**：ECharts 的 `markPoint` 需要额外注册 `MarkPointComponent`，
  当前入口未注册会静默不渲染；改为在卡片说明区展示「单日峰值 N 个」，零体积且始终可见。
- **列表缩略图** 32px → 36px，提升图片/视频行的辨识度。

### 说明

- 文件列表其实早已接入 `ThumbnailImg`（图片/视频走签名缩略图，其余回退类型图标）；
  本轮只是尺寸微调。预览环境的种子数据没有真实 Telegram 对象，因此截图里仍显示图标。

### 验证

- `vue-tsc` / `vite build` / `check:bundle`（余量 8%）通过；vitest 392 项通过。
- 浅色与暗色截图复核：柱状图分布、说明区峰值文案、KPI 卡结构。

## [0.11.0] - 2026-11-01

仪表盘按 shadcn dashboard 的信息结构重构，新增上传趋势接口。

### 新增

- **上传趋势接口** `GET /api/users/me/stats/trend?days=7|30`：
  按天分桶统计上传数量与字节数；服务端补齐零值桶，保证时间轴连续
  （否则「昨天没传」会表现为前后两点相连，视觉上等于伪造趋势），
  跨方言用 `databaseDateBucket`，上限 90 天。
- **趋势图表卡**：标题 + 说明 + 7/30 天分段控件 + 柱状图。
  计数值用柱状而非平滑曲线——平滑会在 0/1 之间插值出不存在的波峰。
- **KPI 卡改为 shadcn SectionCards 结构**：标签 + 右上角图标 + 大数值 + 一句上下文说明
  （如「共 5 个文件」「平均每文件 48.46 MB」），不再只有孤零零的数字。
- **页头带主操作**：标题左侧、主按钮右侧（`.page-header--row`）。
- **最近上传卡**：卡头含说明与「查看全部」，列表改为无多余边框的行式。

### 变更

- echarts 在仪表盘**动态导入**：进入图表渲染时才加载（约 195KB gzip），
  保持项目「非图表页不为 echarts 付体积」的既有约束（utils/echarts.ts 的 PERF 注释）。
- 图表主色跟随新主题（`#1E40AF` / 暗色 `#60A5FA`）。
- `bundle-baseline.json` 更新：新增的设计覆盖样式使 CSS 单块 134.8KB、
  入口资源 370.9KB，属有意的样式增长，已按仓库规定的流程更新基线并在提交说明中记录。

### 验证

- `GET /api/users/me/stats/trend?days=7` 实测返回 7 个连续桶（缺失日补 0）。
- `vue-tsc` / `vite build` / `check:bundle` 通过；vitest 392 项通过；
  jest 1588 项通过（1 个上游遗留 DI 用例仍失败）。
- 浅色与暗色截图复核：KPI 卡结构、柱状图、分段控件、列表行。

## [0.10.0] - 2026-11-01

主色转深蓝，控件层按 shadcn 的尺寸与状态语言重绘。

### 变更

- **主色更蓝更深**：indigo-600 `#4F46E5` → blue-800 `#1E40AF`（白底 8.72:1），
  hover/active 用 blue-900 `#1E3A8A` 继续加深；暗色 `#60A5FA`（zinc-900 上 6.97:1）。
- **控件尺寸对齐 shadcn**：按钮/输入框 36px 高、字号 14px、圆角 8px
  （通过 `--td-comp-size-s/m/l` 与 `--td-radius-*` 统一注入，避免逐组件写死高度）。
- **输入框 focus 改为 ring 扩散**：边框转 `--ring` + 3px 半透明外环，
  替代原来只变边框色的做法。
- **浮层**：Dialog 用 `--radius-xl` + `shadow-lg`，Popup 用 `--radius-lg` + 1px 边框。
- **表格扁平化**：去掉外框与圆角，表头透明 + 底部 1px 分隔线，
  行高 12px / 字号 13–14px，更接近 shadcn 的 Table。
- **outline 按钮修正**：TDesign 的 outline 变体自带不透明底色，暗色下渲染成白块
  （实测 background 计算值为 `rgb(255,255,255)`，与 `--td-bg-color-container` 无关）。
  统一改为透明底，hover 时用 `--accent`。

### 验证

- `vue-tsc` 与 `vite build` 通过；vitest 392 项全部通过。
- 浅色/暗色截图复核：主色深度、控件高度、表格分隔线、outline 按钮底色均正常。

## [0.9.0] - 2026-11-01

视觉体系迁移到 shadcn/ui 语义 token + indigo 主色。

### 变更

- **中性色改为 zinc 梯度**：页面 `#FFFFFF` / 暗色 `#09090B`（zinc-950），
  卡片暗色 `#18181B`（zinc-900），边框 `zinc-200`，次要文字 `#52525B`（7.7:1）、
  三级文字 `#71717A`（4.8:1）。
- **主色改为 indigo**：亮色 indigo-600 `#4F46E5`，暗色 indigo-400 `#818CF8`。
  暗色不用 indigo-500 的原因：它在 zinc-900 上只有 3.97:1，正文不达 AA；
  提亮到 400 后 6.3:1，按钮前景改用近黑（8.9:1）。
- **新增 shadcn 语义别名**：`--background/--foreground/--card/--popover/--primary/
  --secondary/--muted/--accent/--destructive/--border/--input/--ring`；
  旧的 `--color-bg-*` / `--text-*` 保留并映射到新别名，存量组件零改动。
- **圆角改为 shadcn 的 0.625rem 基准**：sm 6 / md 8 / lg 10 / xl 14。
- **扁平化**：侧栏去掉投影只留 1px 边框；品牌徽标与当前导航项去掉渐变，
  改为纯 indigo 填充 + indigo 淡底（shadcn 的 `accent` 用法）。
- **焦点环改用 `--ring`**，与 TDesign 的 `--td-brand-color` 同源。
- `frontend/STYLE_GUIDE.md` 同步更新种子表、语义别名与圆角刻度。

### 验证

- 对比度实测：白底 primary 6.29、次要 7.73、三级 4.83；
  暗底正文 16.97、次要 11.99、三级 6.91、primary 5.94，全部 ≥4.5:1。
- `vue-tsc` 与 `vite build` 通过；vitest 392 项全部通过；浅色/暗色截图复核。

## [0.8.1] - 2026-11-01

修复 SQLite 部署下「有文件即 500」的关联表缺失问题。

### 修复

- **SQLite 缺少 `file_tags` 连接表**：该表只在 PostgreSQL 迁移
  `AddTagsAndFileTags1790000000000` 中创建，而 SQLite 只加载以 `Sqlite` 命名的迁移子集；
  基线迁移按实体建表，不会创建 `@ManyToMany` 的连接表（`tags` 是实体所以存在，
  `file_tags` 是连接表所以缺失）。
- 症状：只要有文件记录，`GET /api/files` 在加载标签关联时就抛
  `SQLITE_ERROR: no such table: file_tags` 并返回 500。空库时不会触发关联查询，
  所以「新装能用、传了文件就不能用」，这也是它一直没被发现的原因。
- 新增迁移 `SqliteAddFileTags1804300000000`：按 PG 版本等价补建
  （两列复合主键 + 指向 files/tags 的级联外键 + tagId 反查索引），幂等。

### 验证

- `sqlite-migrations.spec.ts` 与 `sqlite-real-qa.spec.ts` 共 26 项通过
  （含迁移清单、可逆回滚、数据保留）；
- 真实 SQLite 实例上验证：修复前 `GET /api/files` 500，修复后返回 200 且分页正常。

## [0.8.0] - 2026-11-01

侧栏去灰、整体更有呼吸感与动感。

### 变更

- **侧边栏由浅灰面改为白底**：层级改由「1px 右边框 + 向右的柔和投影」建立，
  内容区与侧栏的白连成一片，不再出现整块灰色色块。
- **当前项改为品牌色渐变胶囊**：左侧 3px 高亮条（圆角胶囊），文字与图标转为品牌色，
  比原来的整行浅蓝底色更有指向性。
- **品牌徽标**：纯色方块改为品牌色渐变 + 同色柔光投影；圆角跟着新半径放大。
- **导航微交互**：悬停时整行右移 2px、图标缩放 1.08，过渡统一用
  `--duration-normal` + `ease-out-expo`。
- **卡片悬停上浮**：卡片 `translateY(-1px)`、统计卡 `-2px`，阴影升到 `--shadow-md`；
  同时把重复的 `transition` 声明合并进 `.card` 基类。
- **登录/注册页氛围底**：在纯白底上叠一层品牌色径向渐变（7% 透明度），
  左右下角各一个 `blur(80px)` 柔光斑，作为纯装饰不承载信息。

### 说明

- 所有新增位移/缩放都在 `prefers-reduced-motion: reduce` 下被全局降级覆盖。
- 侧栏投影在暗色主题下自动收敛（基于 `--seed-fg` 混色，不会出现发白的阴影）。

### 验证

- `vue-tsc` 与 `vite build` 通过；vitest 392 项全部通过。
- 浅色 / 暗色真实截图复核：侧栏白底与内容区的边界、当前项胶囊、登录页氛围底均正常。

## [0.7.0] - 2026-11-01

视觉基调调整：纯白页面底、更柔和的圆角、暗色层级修正。

### 变更

- **页面底色由 #F2F3F3 改为纯白 #FFFFFF**。页面与卡片同为白色后，层级改由
  「浅灰面（侧栏/表头）+ 边框 + 轻阴影」承担：`--color-bg-elevated` 改为
  `fg 4% over bg`，卡片默认带 `--shadow-sm`，避免白底白卡糊成一片。
- **圆角整体放大**：4px 锐利几何 → 6 / 10 / 14 / 20。派生规则由 `×2/×3/×4` 改为
  `+2/+6/+10/+16`，避免 md 直接跳到 16px；卡片 / 表格 / 上传区统一 `--radius-lg`。
- **暗色层级修正**：原卡片面 `#1F242B` 与页面 `#16191F` 仅 1.13:1，卡片几乎不可见。
  改为页面 `#0F131A`、卡片 `#222834`（面差 1.29:1），边框单独覆盖为
  `fg 18% over surface`（1.69:1）。
- **表格密度**：表头 8px、单元格 10px 内边距，配合 14px 字号，一屏多显示 2–3 行；
  表格圆角与卡片对齐。

### 修复

- 后台「用户管理」的注册时间列直接渲染原始值（`2026-10-31T16:20:54.000Z`），
  原因是该列缺少 `#createdAt` slot，TDesign 回退到原始字段；补 `formatDate` 格式化。

### 验证

- 对比度按实际 token 混色值复算：浅色 正文 17.60 / 次要 6.02 / 三级 4.95（灰面 4.58），
  暗色 13.28 / 6.62 / 5.67，均 ≥4.5:1。
- 用真实登录态截图复核浅色与暗色：白底卡片边界、侧栏灰面、暗色卡片面差均可见。
- `vue-tsc` 与 `vite build` 通过；vitest 392 项全部通过。

## [0.6.0] - 2026-11-01

UI 质量提升：修复 P0 缺陷，补 P1 视觉层与 P2 交互细节。

### 修复（P0）

- **表单纵向布局失效**：`Config.vue` / `Users.vue` / `Settings.vue` 共 9 处写成
  `layout="vertical"`，而 TDesign 1.20 中让标签上浮的属性是 `label-align="top"`
  （`Login.vue` 即此写法）。导致标签被压成 100px 横排、长标签截断（如
  "Cloudflare Turnstile" → "Cloudflare Turn..."）、帮助文案挤压输入框。
- **三级文字对比度不达标**：`--text-tertiary` 在浅色下仅 2.63:1、暗色下 3.51:1（AA 要求 4.5:1）。
  调整为 `--text-secondary` 68%、`--text-tertiary` 62%，实测浅色 5.77 / 4.73、
  暗色 6.91 / 6.00，两套主题共用同一比例，无需分叉。
- **品牌蓝不统一**：`TagManager.vue` 色板与 `admin/Files.vue` 的 CSS fallback 仍用
  TDesign 默认蓝 `#0052d9`，与品牌蓝 `#0972D3` 并存；统一到品牌蓝与语义 token。

### 新增（P1）

- **统计卡层级**：首卡（我的文件）加品牌色强调条、渐变底与 32px 数值，
  其余为次级；不再同权重平铺。
- **数值滚动**：新增 `useCountUp` composable（easeOutCubic，520ms），
  仪表盘四项数字平滑过渡；`prefers-reduced-motion` 下直接跳到目标值。
- **骨架屏**：仪表盘统计卡与最近上传、文件列表首屏均用与真实内容同尺寸的骨架占位
  （shimmer 走语义 token），消除首屏 CLS。
- **空状态出口**：仪表盘空状态增加主 CTA「上传第一个文件」，直达文件页。
- **侧边栏折叠**：240px ↔ 72px，状态持久化到 localStorage；折叠后保留图标、
  `title` 提示与无障碍名称，底部「退出登录」在折叠态切换为带 aria-label 的图标按钮。

### 变更（P2）

- **按压反馈**：导航项与移动端卡片 `:active` 用亮度微调（不改尺寸，无抖动）；
  按钮按下位移 1px。
- **列表进入**：文件/文件夹行 40ms 阶梯淡入，仅前 8 行参与延迟。
- **动效降级**：全局 `prefers-reduced-motion: reduce` 覆盖动画/过渡/骨架 shimmer，
  按压位移一并取消（WCAG 2.3.3）。

### 验证

- `vue-tsc` 与 `vite build` 通过；vitest 392 项全部通过。
- 用本地 SQLite 空库 + 真实登录态截图复核：表单已纵向、配置页标签完整、
  折叠态 72px 无溢出、骨架屏在接口延迟 3s 时正常渲染。
- 对比度用脚本按 token 实际混色值复算（非估算）。

## [0.5.0] - 2026-10-31

针对 Telegram 的核心优化：上传内容去重，省掉重复上行带宽。

### 新增

- `ContentDedupeService`：按内容 sha256 判断同一用户是否已有相同文件，
  命中时复用其 Telegram `file_id` / `message_id` / 来源账号，**不发送任何上行字节**。
- 两条上传路径均已接入：同步单文件上传（类型校验后计算摘要）与队列上传
  （异步 / 批量 / 分片合并，在 processor 真正上行前计算）。
- `files.contentHash` + `idx_files_uploader_hash` 索引（迁移 `1804200000000`，PG/SQLite）。
- `UPLOAD_DEDUPE_ENABLED` 开关（默认开启，关闭后退回改造前行为）。

### 设计取舍

- 只复用 `status='ready'`、未删除、`telegramFileId` 非空且有相同 `size` 的记录；
  命中方沿用来源账号字段（`file_id` 与 Bot 账号绑定，禁止跨账号复用）。
- **只在同一 uploaderId 内复用**：跨用户去重能省更多，但会让「A 上传后 B 立即命中」
  成为可观测侧信道，且配额/删除语义需要先设计，因此不做。
- 共享 Telegram 对象与既有「删除文件不删远端对象」的设计一致；
  配额仍按逻辑记录计量。

### 变更

- 同步上传落库时补写 `telegramMessageId` / `telegramChatId` /
  `telegramFileUniqueId` / `telegramSourceAccountId`（此前只有队列路径会写），
  使去重复用与后续镜像/副本判断都有完整锚点。
- 版本号 `0.5.0`。

## [0.4.0] - 2026-10-31

配额支持批量运营。

### 新增

- `PUT /api/admin/users/quota/batch`：一次调整最多 500 个用户的配额，
  单条 `IN (...)` 更新；返回 `{ requested, updated, missing }`，
  `missing` 区分「请求里重复的 id」与「库里不存在/已软删的 id」。
- DTO 校验：`userIds` 非空、每项 UUID v4、`quotaBytes` 必填（`null` = 恢复默认，`0` = 不限），
  缺省时直接 400——避免把「忘了传」误当成「设为不限」。

### 变更

- 版本号 `0.4.0`；`docs/api-routes.md` 补三个配额端点。

## [0.3.0] - 2026-10-31

补齐存储抽象的写入路径：对象存储不再只读。

### 新增

- `StorageBackend` 端口新增写能力：`writable` 标志 + 可选的 `put` / `deleteObject`。
  Telegram 后端显式声明 `writable=false`（上传仍由账号池/镜像链路承担），S3 后端为 true。
- S3 写入：`UNSIGNED-PAYLOAD` 摘要 + 流式 PUT（`duplex: 'half'`），大文件不必读进内存；
  删除幂等（404 视为已删除）。
- `FILE_STORAGE_PROVIDER=telegram|s3`：设为 `s3` 时同步上传与批量上传直接写对象存储；
  配置不完整或后端不可写时**直接报错，不静默回退**到 Telegram。
- 对象 key 规则：`YYYY/MM/DD/<uuid>-<安全化文件名>`；落库失败会补偿删除已写入对象。
- `StorageService.putObject` / `deleteObject` / `isWritable`，写请求按 provider 分派。

### 变更

- 同步上传在类型校验通过后分流：`FILE_STORAGE_PROVIDER` 未设置或为 `telegram` 时，
  行为与改造前完全一致。
- 版本号 `0.3.0`。

### 已知限制

- 异步上传、分片上传、Bot 私聊直链、镜像与副本扩散仍只支持 Telegram（其语义依赖
  `message_id` / `file_id`）。
- 删除文件不删除对象：既有设计明确「引用副本可能共享远端对象」，无引用计数时自动删对象
  会误删；建议在 bucket 侧配置生命周期规则兜底（见 `docs/storage.md`）。

## [0.2.0] - 2026-10-31

三项产品化改造：容器化部署、用户存储配额、存储抽象（读路径）。

### 新增

- **Docker Compose 部署**：`Dockerfile`（前端 → 后端 → 运行时的三阶段构建，非 root 运行、
  tini 转发信号、内置 `/api/health` 健康检查）、`docker-compose.yml`（postgres + redis + app，
  迁移由 entrypoint 启动前执行且 fail-closed）、`docker/env.example`、`.dockerignore`、
  `docs/deployment-docker.md`。
- **用户存储配额**：`users.storageQuotaBytes`（NULL 继承全局默认、0 不限、>0 为字节上限）+
  `QuotaService` 对 `files` 表实时 `SUM(size)` 汇总（不做冗余计数，避免多上传路径漂移）+
  同步/异步/批量/分片四条上传入口拦截 + `GET /api/quota`、`GET|PUT /api/admin/users/:id/quota` +
  个人设置页配额展示与 90% 预警 + `DEFAULT_USER_STORAGE_QUOTA_MB` 环境变量。
- **存储抽象（读路径）**：`StorageBackend` 端口 + Telegram / S3 两个实现 +
  `files.storageProvider` / `files.storageKey` 列 + `StorageService` 按 provider 分派。
  S3 实现自带 SigV4 签名（以 AWS 官方 `GET Object` 示例做向量测试）与原生 Range 读取。
- `docs/storage.md`：数据模型、接入点、配置与「单文件切到 S3」的操作步骤。

### 变更

- 读路径新增统一入口 `FileService.openUpstreamStream()`：`storageProvider` 为空时行为与
  改造前逐字节一致（账号池/副本/镜像逻辑不变），仅显式 `s3` 的文件改走对象存储。
- 版本号 `0.2.0`，`VERSION` 与前后端清单、锁文件同步。

### 已知限制

- 写入路径仍为 Telegram（上传选号、镜像、副本扩散与 Telegram 语义强绑定），
  S3 目前只承担读；`docs/storage.md` 说明了原因与后续增量路径。
- 镜像构建未在本机验证（开发机未安装 Docker），首次 `docker compose build` 需自行确认。

## [0.1.0] - 2026-10-31

首个自有版本，基线为上游 TGTC v1.6.3。定位是「把上游变成可自主演进的产品底座」，
本版本只做品牌与结构的解耦，不改业务行为。

### 新增

- `brand.json`：品牌唯一事实源（slug / 中文名 / 英文名 / 上一版本标识）。
- `backend/src/common/brand.ts`、`frontend/src/brand.ts`：由事实源生成的品牌常量，
  收敛站点标题、API Key 前缀、业务错误码响应头、SQLite 默认文件名。
- `scripts/rename-brand.mjs`：一条命令完成全仓改名（受控替换 + 常量重生成），
  避免下次改名再靠人工搜索。
- `NOTICE`：上游版权归属与 GPL-3.0 义务说明。

### 变更

- 品牌由 TGTC / 「文件分发系统」改为 `nebula` / 「星云盘」，覆盖页面标题、
  邮件主题、API Key 前缀（`nebula_…`）、错误码响应头（`X-Nebula-Error-Code`）、
  systemd 单元名、安装路径、SQLite 默认文件名与发行包命名。
- 包名改为 `nebula-backend` / `nebula-frontend`。
- 版本号重起算为 `0.1.0`（`VERSION` 与前后端清单、锁文件同步）。

### 移除

- 后端 `src/update/` 自更新模块（GitHub Release 拉取、GPG 验签、
  更新任务状态机、systemd oneshot 派发与 polkit 授权），共 16 个文件。
- `UpdateTask` 实体（`update_task` 历史表保留，迁移链未改动）。
- 管理后台「系统更新」页面、路由、权限项、侧边栏入口与前端 `update` API/类型。
- `scripts/release/updater.sh`、`scripts/release/systemd/nebula-update@.service`、
  `nebula-update.sudoers`，以及 `start.sh` 中的单元/polkit 安装逻辑。
- `docs/release-notes/`（上游历史发行说明）。

### 保留

- `scripts/release/upgrade.sh` / `rollback.sh` 手工升级与回退路径，
  以及发行清单、SHA256SUMS 签名与验签链路。
- 上游全部业务能力、迁移链与测试体系。

### 已知事项

- `update_task` 表仍会由历史迁移创建，但已无代码读写；后续可随迁移链 squash 一并清理。
- `scripts/release/update-public-key.pem` 仍是上游公钥，仅用于发行包验签；
  对外发版前应替换为你自己的密钥对（私钥放 CI secret，公钥入库）。
