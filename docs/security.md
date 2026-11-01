# 安全说明

> 本文档由原 README 拆分而来。启动顺序、CSRF 与部署预检等实现级契约见 `backend/src/main.ts`、`backend/src/common/guards/csrf.guard.ts` 与 `backend/src/config/deployment-preflight.ts`。总索引见 [README](../README.md)。

---

- 不要把 `.env`、Token、密码或加密密钥提交到仓库。
- 生产环境必须使用 HTTPS、强 `JWT_SECRET`、明确 CORS 来源和 `SECURE_COOKIE=true`。
- Telegram Token 会在错误日志中脱敏；生产异常响应不返回堆栈。
- 全局 `ValidationPipe` 启用白名单、类型转换和非白名单字段拒绝。
- Helmet 提供安全响应头；前端 CSP 由 `frontend/index.html` 管理。
- 关键写操作进入审计日志；访问日志按配置定期清理。
- 默认访问日志保留 30 天、审计日志保留 90 天。

---

## 安全契约变更记录

- **登出要求 CSRF 双重提交**（v1.6.0 审查修复 SEC-102）：`POST /api/auth/logout` 已退出双重提交豁免清单。携带会话 Cookie 的登出请求必须携带与 `XSRF-TOKEN` Cookie 一致的 `X-XSRF-TOKEN` 请求头（前端 axios 实例统一注入），缺少或不一致返回 403；未签发 `XSRF-TOKEN` 的存量会话由服务端在响应中补发 Cookie 后，前端自动重试一次即完成登出。
- **分享密码校验响应体不再返回 `accessJwt`**（v1.6.0 审查修复 SEC-103）：`POST /api/s/:token/verify` 验证通过后，访问凭据仅通过 HttpOnly `share_access` Cookie 下发，响应体不包含任何访问令牌（兼容期结束）。

## 依赖告警评估（2026-11）

`npm audit --omit=dev` 的处理结论，避免下次重复排查：

| 依赖 | 结论 | 原因 |
|---|---|---|
| `js-yaml` | **已修复** | `@nestjs/swagger` 传递依赖落在受影响区间；用 `overrides` 固定到 `^5.4.3`（实际 5.5.0），构建与全量测试通过 |
| `glob` / `minimatch` | **不修** | 仅存在于 dev 工具链（`@nestjs/cli`、`jest`）与 typeorm 的迁移文件匹配；利用需要攻击者控制 glob 模式，本项目的模式均为内部常量。强升会破坏 glob 7 / minimatch 3 的 API |
| `typeorm`（经 minimatch） | **不修** | 同上；正文依赖升级到 1.x 属于破坏性变更，需单独排期并跑全量回归 |

> 生产镜像用 `npm prune --omit=dev` 构建，dev 工具链不进镜像；因此 glob/minimatch
> 的实际暴露面是开发者机器与 CI。
