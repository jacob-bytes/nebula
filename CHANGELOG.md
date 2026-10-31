# 变更日志

本文件记录本仓库（Nebula / 星云盘）自上游分叉后的自有变更。
上游 1.6.3 及更早的历史不再维护于此。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

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
