#!/usr/bin/env bash
# 星云盘恢复脚本：从 scripts/ops/backup.sh 产出的快照目录恢复元数据。
#
# 安全默认：
#   - 恢复前先校验快照的 sha256（MANIFEST.txt），不匹配直接拒绝；
#   - 目标库**已有数据时必须显式加 --force**，避免误覆盖线上库；
#   - PostgreSQL 用 pg_restore --clean --if-exists（先删后建）；SQLite 采用
#     "先写临时文件 → 原子替换"，中途失败不会留下半个库。
#
# 用法：
#   scripts/ops/restore.sh backups/20261101-153300                 # 直连本机
#   scripts/ops/restore.sh backups/20261101-153300 --compose       # 经 docker compose
#   scripts/ops/restore.sh backups/20261101-153300 --force         # 覆盖非空库
set -Eeuo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)
SNAP=""
MODE=local
FORCE=0

die() { printf '错误：%s\n' "$*" >&2; exit 1; }
log() { printf '[restore] %s\n' "$*"; }

usage() {
  sed -n '2,16p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --compose) MODE=compose; shift ;;
    --force) FORCE=1; shift ;;
    -h|--help) usage 0 ;;
    -*) printf '未知参数：%s\n' "$1" >&2; usage 2 ;;
    *) SNAP=$1; shift ;;
  esac
done

[[ -n "$SNAP" ]] || usage 2
[[ -d "$SNAP" ]] || die "快照目录不存在：$SNAP"

if [[ -f "$ROOT_DIR/.env" ]]; then
  while IFS= read -r line; do
    [[ "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]] || continue
    key=${line%%=*}
    [[ -n "${!key:-}" ]] && continue
    # KEY=VALUE 作为 export 的参数是合法赋值；加 ${var?} 只是为了让 shellcheck 安分
    export "${line?}"
  done < "$ROOT_DIR/.env"
fi

DB_TYPE=${DB_TYPE:-postgres}
DB_TYPE=$(printf '%s' "$DB_TYPE" | tr '[:upper:]' '[:lower:]')

# ---- 校验快照完整性 --------------------------------------------------------
MANIFEST="$SNAP/MANIFEST.txt"
[[ -f "$MANIFEST" ]] || die "缺少 MANIFEST.txt，拒绝恢复未经验证的快照"

get() { awk -F= -v k="$1" '$1==k { print substr($0, length(k)+2) }' "$MANIFEST"; }
want_type=$(get db_type)
want_sum=$(get sha256)
want_file=$(get file)
[[ "$want_type" == "$DB_TYPE" ]] || die "快照类型($want_type) 与当前 DB_TYPE($DB_TYPE) 不一致"
[[ -f "$SNAP/$want_file" ]] || die "快照文件缺失：$want_file"
actual_sum=$(sha256sum "$SNAP/$want_file" | awk '{print $1}')
[[ "$actual_sum" == "$want_sum" ]] || die "sha256 不匹配（快照已损坏或被篡改）"
log "快照校验通过：${want_file}（$(get size_bytes) 字节，version=$(get version)）"

# ---- 覆盖保护 --------------------------------------------------------------
case "$DB_TYPE" in
  sqlite)
    TARGET=${DB_DATABASE:-data/nebula.sqlite}
    [[ "$TARGET" = /* ]] || TARGET="$ROOT_DIR/$TARGET"
    if [[ -s "$TARGET" && "$FORCE" -ne 1 ]]; then
      die "目标数据库已存在：${TARGET}（确认要覆盖请加 --force；请先停服）"
    fi
    mkdir -p "$(dirname "$TARGET")"
    tmp="${TARGET}.restore.$$"
    cp "$SNAP/$want_file" "$tmp"
    mv -f "$tmp" "$TARGET"
    log "已原子替换 SQLite 数据库：$TARGET"
    ;;
  postgres)
    if [[ "$MODE" == compose ]]; then
      command -v docker >/dev/null 2>&1 || die "缺少 docker 命令"
      user=${POSTGRES_USER:-nebula}
      db=${POSTGRES_DB:-nebula}
      if [[ "$FORCE" -ne 1 ]]; then
        count=$(docker compose -f "$ROOT_DIR/docker-compose.yml" exec -T postgres \
          psql -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" -U "$user" "$db" 2>/dev/null || echo 0)
        [[ "${count:-0}" -le 1 ]] || die "目标库已有 ${count} 张表（确认覆盖请加 --force）"
      fi
      docker compose -f "$ROOT_DIR/docker-compose.yml" exec -T postgres \
        pg_restore --clean --if-exists --no-owner --no-privileges -U "$user" -d "$db" < "$SNAP/$want_file"
    else
      command -v pg_restore >/dev/null 2>&1 || die "缺少 pg_restore（可改用 --compose）"
      : "${DB_HOST:?缺少 DB_HOST}" "${DB_USERNAME:?缺少 DB_USERNAME}" "${DB_DATABASE:?缺少 DB_DATABASE}"
      if [[ "$FORCE" -ne 1 ]]; then
        count=$(PGPASSWORD=${DB_PASSWORD:-} psql -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" \
          -h "$DB_HOST" -p "${DB_PORT:-5432}" -U "$DB_USERNAME" "$DB_DATABASE" 2>/dev/null || echo 0)
        [[ "${count:-0}" -le 1 ]] || die "目标库已有 ${count} 张表（确认覆盖请加 --force）"
      fi
      PGPASSWORD=${DB_PASSWORD:-} pg_restore --clean --if-exists --no-owner --no-privileges \
        -h "$DB_HOST" -p "${DB_PORT:-5432}" -U "$DB_USERNAME" -d "$DB_DATABASE" < "$SNAP/$want_file"
    fi
    log "PostgreSQL 恢复完成"
    ;;
  *)
    die "未知 DB_TYPE：$DB_TYPE"
    ;;
esac

log "恢复完成。建议随后执行："
log "  1) 启动应用并检查 /api/health"
log "  2) 登录后台确认文件数与最近上传正常"
log "  3) 抽查一个文件的下载（验证 Telegram file_id 仍有效）"
