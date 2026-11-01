#!/usr/bin/env bash
# E2E 用的后端启动器：一次性 SQLite 库 + 固定测试数据 + 生产构建产物。
#
# 由 Playwright 的 webServer 调用（见 frontend/playwright.config.ts）。
# 前提：backend/dist 与 frontend/dist 已构建（CI 里显式 build；本地用 npm run build）。
#
# 隔离性：数据库与上传目录都放在仓库下的 .tmp-e2e/，每次启动重建，不碰开发数据。
set -Eeuo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)
WORK_DIR="$ROOT_DIR/.tmp-e2e"
DB_FILE="$WORK_DIR/e2e.sqlite"
PORT=${E2E_PORT:-3999}

die() { printf '错误：%s\n' "$*" >&2; exit 1; }
log() { printf '[e2e] %s\n' "$*"; }

[[ -f "$ROOT_DIR/backend/dist/main.js" ]] || die "缺少 backend/dist，请先在 backend 执行 npm run build"
[[ -f "$ROOT_DIR/frontend/dist/index.html" ]] || die "缺少 frontend/dist，请先在 frontend 执行 npm run build"

mkdir -p "$WORK_DIR"
rm -f "$DB_FILE"

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

cd "$ROOT_DIR/backend"
log '执行迁移'
DB_TYPE=sqlite DB_DATABASE="$DB_FILE" \
  node ./node_modules/typeorm/cli.js migration:run -d ./dist/database/data-source.js >/dev/null

log '写入测试数据'
DB_FILE="$DB_FILE" node "$ROOT_DIR/scripts/e2e/seed.mjs"

log "启动服务（端口 ${PORT}）"
DB_TYPE=sqlite DB_DATABASE="$DB_FILE" \
JWT_SECRET=${E2E_JWT_SECRET:-e2e-only-secret-0123456789abcdef0123456789abcdef} \
APP_HOST=127.0.0.1 APP_PORT="$PORT" \
APP_URL="http://127.0.0.1:$PORT" CORS_ORIGINS="http://127.0.0.1:$PORT" \
SECURE_COOKIE=false NODE_ENV=production \
TELEGRAM_BOT_TOKEN=123456:e2e TELEGRAM_CHAT_ID=-1001234567890 \
REDIS_HOST=127.0.0.1 REDIS_PORT=6399 \
node dist/main.js &
SERVER_PID=$!

# 等健康检查就绪（最多 60s）
for _ in $(seq 1 60); do
  if curl -sf -m 2 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    log '就绪'
    wait "$SERVER_PID"
    exit 0
  fi
  sleep 1
done
die '服务在 60s 内未就绪'
