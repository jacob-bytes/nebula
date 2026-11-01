#!/usr/bin/env bash
# 说明：本脚本是 **upgrade.sh 升级前内部调用的备份**（bare-metal / systemd 语义，
# 依赖 common.sh 的安装根与停服逻辑）。面向运维的通用备份入口是
# scripts/ops/backup.sh（支持 --systemd 与 --compose、带 MANIFEST 与 sha256 校验），
# 恢复统一用 scripts/ops/restore.sh。
set -Eeuo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/common.sh"

# Exit codes: 0 success; 2 usage; 3 precheck; 4 verification; 5 operation failure.
BACKUP_ROOT="${NEBULA_BACKUP_DIR:-$INSTALL_ROOT/backups}"
KEEP_DAYS="${NEBULA_BACKUP_KEEP_DAYS:-14}"
# Canonicalize and reject symlinked paths before creating backups or pruning directories.
[[ "$BACKUP_ROOT" = /* ]] || die "$EXIT_PRECHECK" "备份目录必须是绝对路径：$BACKUP_ROOT"
case "$BACKUP_ROOT" in
  *"/../"*|*/..|*"/./"*|*/.) die "$EXIT_PRECHECK" "备份目录不得包含 . 或 .. 路径分量：$BACKUP_ROOT" ;;
esac
[[ ! -L "$INSTALL_ROOT" ]] || die "$EXIT_PRECHECK" "安装根目录不得为符号链接：$INSTALL_ROOT"
install_root_real=$(realpath -e -- "$INSTALL_ROOT") || die "$EXIT_PRECHECK" '无法规范化安装根目录。'
backup_parent=$(dirname -- "$BACKUP_ROOT")
mkdir -p -- "$backup_parent"
[[ ! -L "$backup_parent" ]] || die "$EXIT_PRECHECK" "备份父目录不得为符号链接：$backup_parent"
backup_parent_real=$(realpath -e -- "$backup_parent") || die "$EXIT_PRECHECK" '无法规范化备份父目录。'
case "$backup_parent_real" in
  "$install_root_real"|"$install_root_real"/*) ;;
  *) die "$EXIT_PRECHECK" "规范化后的备份目录必须位于安装根目录内：$BACKUP_ROOT" ;;
esac
BACKUP_ROOT="$backup_parent_real/$(basename -- "$BACKUP_ROOT")"
[[ ! -L "$BACKUP_ROOT" ]] || die "$EXIT_PRECHECK" "备份目录不得为符号链接：$BACKUP_ROOT"
[[ ! -e "$BACKUP_ROOT" || -d "$BACKUP_ROOT" ]] || die "$EXIT_PRECHECK" "备份路径已存在但不是目录：$BACKUP_ROOT"
ENV_FILE="${NEBULA_ENV_FILE:-$RUNTIME_DIR/backend/.env}"
SERVICE="${NEBULA_SERVICE:-nebula.service}"
[[ "$KEEP_DAYS" =~ ^[0-9]+$ ]] || die "$EXIT_USAGE" 'NEBULA_BACKUP_KEEP_DAYS 必须是非负整数。'
require_linux; require_cmd sha256sum; require_cmd flock; acquire_lock
[[ -r "$ENV_FILE" ]] || die "$EXIT_PRECHECK" "无法读取应用环境文件：$ENV_FILE"
# Only accepts simple KEY=VALUE lines; deliberately does not source .env.
env_value() {
  local key=$1 value
  value=$(sed -n "s/^[[:space:]]*${key}[[:space:]]*=[[:space:]]*//p" "$ENV_FILE" | tail -n1)
  value=${value%$'\r'}
  if [[ ${value:0:1} == '"' && ${value: -1} == '"' ]]; then value=${value:1:${#value}-2}; fi
  if [[ ${value:0:1} == "'" && ${value: -1} == "'" ]]; then value=${value:1:${#value}-2}; fi
  printf '%s' "$value"
}
DB_TYPE=$(env_value DB_TYPE); DB_TYPE=${DB_TYPE:-postgres}
STAMP=$(date -u +%Y%m%dT%H%M%SZ); DEST="$BACKUP_ROOT/$STAMP"; mkdir -p "$DEST"; chmod 0700 "$DEST"

case "$DB_TYPE" in
  postgres)
    require_cmd pg_dump
    DB_HOST=$(env_value DB_HOST); DB_PORT=$(env_value DB_PORT); DB_USERNAME=$(env_value DB_USERNAME); DB_DATABASE=$(env_value DB_DATABASE)
    [[ -n "$DB_HOST" && -n "$DB_PORT" && -n "$DB_USERNAME" && -n "$DB_DATABASE" ]] || die "$EXIT_PRECHECK" 'PostgreSQL 配置不完整。'
    # Password is intentionally supplied only via current process env, never logged or written.
    PGPASSWORD="$(env_value DB_PASSWORD)" pg_dump --format=custom --no-owner --no-privileges --host "$DB_HOST" --port "$DB_PORT" --username "$DB_USERNAME" --dbname "$DB_DATABASE" --file "$DEST/database.pg.dump"
    pg_restore --list "$DEST/database.pg.dump" >/dev/null
    ;;
  sqlite)
    # sqlite3 CLI 不是发行包的依赖：最小化系统上往往没有它。
    # 服务此时已停（下面会停），因此缺少 CLI 时可以安全退化为文件拷贝；
    # 有 CLI 时仍用 `.backup`（一致性更好）并做 integrity_check。
    require_cmd systemctl
    DB_DATABASE=$(env_value DB_DATABASE); [[ -n "$DB_DATABASE" ]] || die "$EXIT_PRECHECK" 'SQLite DB_DATABASE 未配置。'
    # P1-05：.env 与运行库都位于 $RUNTIME_DIR/backend（服务 WorkingDirectory 同为该目录），
    # 相对路径必须以 .env 所在目录解析；此前按发行目录解析必然找不到真实库。
    [[ "$DB_DATABASE" = /* ]] || DB_DATABASE="$RUNTIME_DIR/backend/$DB_DATABASE"
    [[ -f "$DB_DATABASE" ]] || die "$EXIT_PRECHECK" "SQLite 数据库不存在：$DB_DATABASE"
    systemctl is-active --quiet "$SERVICE" && systemctl stop "$SERVICE"
    stopped=1
    # NEBULA_BACKUP_KEEP_STOPPED=1（升级流程调用）：备份后保持停机进入停写窗口，
    # 由 upgrade.sh 在迁移+切链完成后统一恢复服务；独立备份仍默认恢复运行。
    trap 'if [[ ${stopped:-0} == 1 && ${NEBULA_BACKUP_KEEP_STOPPED:-0} != 1 ]]; then systemctl start "$SERVICE" >/dev/null 2>&1 || true; fi' EXIT
    if command -v sqlite3 >/dev/null 2>&1; then
      sqlite3 "$DB_DATABASE" ".backup '$DEST/database.sqlite'"
      [[ "$(sqlite3 "$DEST/database.sqlite" 'PRAGMA integrity_check;')" == ok ]] || die "$EXIT_VERIFY" 'SQLite 备份完整性检查失败。'
    else
      # 降级路径：服务已停止，直接拷贝文件；用大小比对做最低限度校验，
      # 并在日志里说清「未执行 integrity_check」，避免让人误以为体检过。
      warn '未找到 sqlite3 命令：退化为停服后文件拷贝（未执行 integrity_check）。建议安装 sqlite3 以获得一致性备份。'
      cp --preserve=all -- "$DB_DATABASE" "$DEST/database.sqlite"
      [[ "$(wc -c < "$DB_DATABASE")" == "$(wc -c < "$DEST/database.sqlite")" ]] \
        || die "$EXIT_VERIFY" 'SQLite 备份大小与原库不一致。'
    fi
    if [[ ${NEBULA_BACKUP_KEEP_STOPPED:-0} == 1 ]]; then
      log '按升级流程要求保持服务停止（停写窗口）；服务恢复由调用方负责。'
    else
      systemctl start "$SERVICE"; stopped=0
    fi
    ;;
  *) die "$EXIT_PRECHECK" "不支持的 DB_TYPE：$DB_TYPE" ;;
esac
sha256sum "$DEST"/* > "$DEST/SHA256SUMS"
printf 'version=%s\ndb_type=%s\ncreated_at=%s\n' "$(read_version "$RELEASE_ROOT/VERSION")" "$DB_TYPE" "$STAMP" > "$DEST/metadata"
find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -mtime +"$KEEP_DAYS" -exec rm -rf -- {} +
record_state "backup ok type=$DB_TYPE path=$DEST"
log "OK: 已创建并验证备份：$DEST"
