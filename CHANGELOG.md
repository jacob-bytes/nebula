# 变更日志

本文件记录本仓库（Nebula / 星云盘）自上游分叉后的自有变更。
上游 1.6.3 及更早的历史不再维护于此。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

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
