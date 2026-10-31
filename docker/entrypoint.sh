#!/bin/sh
# 星云盘容器启动脚本。
#
# 只做两件事：按需执行数据库迁移，然后把进程交给 Node。
# 不使用 exec 之外的进程管理，信号由 tini 转发。
set -eu

cd /app/backend

# 迁移策略：
#   RUN_MIGRATIONS_ON_START=true（默认）  启前用 TypeORM CLI 执行待处理迁移，失败即退出（fail-closed）
#   RUN_MIGRATIONS_ON_START=false         跳过（多副本部署时应由单独的 job 执行，避免并发迁移）
#
# SQLite 单机模式下同样适用：DB_TYPE=sqlite 时 data-source.js 会使用 SQLite 迁移子集。
if [ "${RUN_MIGRATIONS_ON_START:-true}" = "true" ]; then
  echo "[entrypoint] 执行数据库迁移（DB_TYPE=${DB_TYPE:-postgres}）"
  # 迁移日志写 stdout，便于 docker logs 直接观察；失败退出码透传给容器
  if ! node ./node_modules/typeorm/cli.js migration:run -d ./dist/database/data-source.js; then
    echo "[entrypoint] 迁移失败，拒绝启动（避免新版程序跑在旧 schema 上）" >&2
    exit 1
  fi
else
  echo "[entrypoint] 已跳过启动迁移（RUN_MIGRATIONS_ON_START=false）"
fi

# 应用自身的 migrationsRun 由运行期关闭，迁移只由上面这一步负责，避免双重执行
export DB_MIGRATIONS_RUN=false

echo "[entrypoint] 启动应用：http://${APP_HOST:-0.0.0.0}:${APP_PORT:-3000}"
exec node dist/main.js
