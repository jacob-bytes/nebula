#!/usr/bin/env bash
# 星云盘备份脚本：把**元数据**（数据库）打成一个可验证的快照目录。
#
# 为什么必须备份：文件本体在 Telegram，本地只有元数据与缓存。元数据丢了，
# 即使 Telegram 上的文件还在，也没有任何途径把它们重新关联成"文件列表"。
# 缓存（tmp/Cache）与发行包可以重建，不需要备份。
#
# 用法：
#   scripts/ops/backup.sh                     # 直接连本机数据库（读 .env）
#   scripts/ops/backup.sh --compose           # 通过 docker compose exec 在 postgres 容器内导出
#   scripts/ops/backup.sh --out /mnt/backups --keep 14
#
# 产物（每个快照一个目录）：
#   <out>/<YYYYmmdd-HHMMSS>/
#     database.dump | nebula.sqlite   # pg: custom format；sqlite: 一致性副本
#     MANIFEST.txt                    # 版本、类型、大小、sha256、创建时间
#
# 不含：.env（含密钥）、Telegram workdir（与 file_id 强绑定，迁移需整体搬迁）、缓存。
set -Eeuo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)
MODE=local
OUT_DIR=""
KEEP=7

die() { printf '错误：%s\n' "$*" >&2; exit 1; }
log() { printf '[backup] %s\n' "$*"; }

usage() {
  sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --compose) MODE=compose; shift ;;
    --out) OUT_DIR=${2:?--out 需要目录参数}; shift 2 ;;
    --keep) KEEP=${2:?--keep 需要整数}; shift 2 ;;
    -h|--help) usage 0 ;;
    *) printf '未知参数：%s\n' "$1" >&2; usage 2 ;;
  esac
done

[[ "$KEEP" =~ ^[0-9]+$ ]] || die "--keep 必须是整数"

# 读取 .env（存在时），但不覆盖已显式导出的变量
if [[ -f "$ROOT_DIR/.env" ]]; then
  while IFS= read -r line; do
    [[ "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]] || continue
    key=${line%%=*}
    [[ -n "${!key:-}" ]] && continue
    export "$line"
  done < "$ROOT_DIR/.env"
fi

DB_TYPE=${DB_TYPE:-postgres}
DB_TYPE=$(printf '%s' "$DB_TYPE" | tr '[:upper:]' '[:lower:]')
OUT_DIR=${OUT_DIR:-$ROOT_DIR/backups}
STAMP=$(date +%Y%m%d-%H%M%S)
SNAP="$OUT_DIR/$STAMP"
mkdir -p "$SNAP"

VERSION=$(tr -d '[:space:]' < "$ROOT_DIR/VERSION" 2>/dev/null || echo unknown)

write_manifest() {
  local file=$1 size sum
  size=$(wc -c < "$file" | tr -d ' ')
  sum=$(sha256sum "$file" | awk '{print $1}')
  {
    printf 'version=%s\n' "$VERSION"
    printf 'db_type=%s\n' "$DB_TYPE"
    printf 'created_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'file=%s\n' "$(basename "$file")"
    printf 'size_bytes=%s\n' "$size"
    printf 'sha256=%s\n' "$sum"
  } > "$SNAP/MANIFEST.txt"
}

case "$DB_TYPE" in
  sqlite)
    DB_FILE=${DB_DATABASE:-data/nebula.sqlite}
    [[ "$DB_FILE" = /* ]] || DB_FILE="$ROOT_DIR/$DB_FILE"
    [[ -f "$DB_FILE" ]] || die "SQLite 数据库不存在：$DB_FILE"
    # 应用运行中直接 cp 可能拿到半写状态；优先用 VACUUM INTO 做一致性快照
    if command -v sqlite3 >/dev/null 2>&1; then
      sqlite3 "$DB_FILE" "VACUUM INTO '$SNAP/nebula.sqlite'"
    else
      log "未找到 sqlite3 命令，退化为文件拷贝（建议先停服）"
      cp "$DB_FILE" "$SNAP/nebula.sqlite"
    fi
    # 完整性校验：备份本身坏掉比没有备份更危险
    if command -v sqlite3 >/dev/null 2>&1; then
      result=$(sqlite3 "$SNAP/nebula.sqlite" 'PRAGMA integrity_check;')
      [[ "$result" == 'ok' ]] || die "备份文件完整性检查失败：$result"
    fi
    write_manifest "$SNAP/nebula.sqlite"
    ;;
  postgres)
    DUMP="$SNAP/database.dump"
    if [[ "$MODE" == compose ]]; then
      command -v docker >/dev/null 2>&1 || die "缺少 docker 命令"
      user=${POSTGRES_USER:-nebula}
      db=${POSTGRES_DB:-nebula}
      log "通过 docker compose 导出（user=$user db=${db}）"
      docker compose -f "$ROOT_DIR/docker-compose.yml" exec -T postgres \
        pg_dump --format=custom --no-owner --no-privileges -U "$user" "$db" > "$DUMP"
    else
      command -v pg_dump >/dev/null 2>&1 || die "缺少 pg_dump（可改用 --compose）"
      : "${DB_HOST:?缺少 DB_HOST}" "${DB_USERNAME:?缺少 DB_USERNAME}" "${DB_DATABASE:?缺少 DB_DATABASE}"
      log "直连 $DB_HOST:${DB_PORT:-5432} 导出"
      PGPASSWORD=${DB_PASSWORD:-} pg_dump \
        --format=custom --no-owner --no-privileges \
        -h "$DB_HOST" -p "${DB_PORT:-5432}" -U "$DB_USERNAME" "$DB_DATABASE" > "$DUMP"
    fi
    [[ -s "$DUMP" ]] || die "导出文件为空"
    write_manifest "$DUMP"
    ;;
  *)
    die "未知 DB_TYPE：${DB_TYPE}（只支持 postgres / sqlite）"
    ;;
esac

log "快照完成：$SNAP"
cat "$SNAP/MANIFEST.txt" | sed 's/^/  /'

# 保留策略：只删本脚本自己生成的快照目录
# 注意：macOS 自带 bash 3.2 没有 mapfile，这里用 while read 保证可移植
if [[ "$KEEP" -gt 0 ]]; then
  while IFS= read -r old; do
    [[ -n "$old" ]] || continue
    log "清理旧快照（保留 $KEEP 份）：$(basename "$old")"
    rm -rf "$old"
  done < <(find "$OUT_DIR" -maxdepth 1 -mindepth 1 -type d -name '20*-*' | sort -r | tail -n +$((KEEP + 1)))
fi
