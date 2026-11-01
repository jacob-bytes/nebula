#!/usr/bin/env bash
# 备份 / 恢复自检：验证「备份 → 破坏 → 恢复 → 数据完好」整条链路。
#
# 为什么需要它：备份脚本最危险的失败方式是「看起来备份成功、其实不可恢复」。
# 这个自检用一次性数据跑完整往返，并额外验证两个安全属性（覆盖保护、篡改检测）。
#
# 用法：
#   scripts/ops/selftest.sh              # 自动：有 docker 就测 PostgreSQL，否则测 SQLite
#   scripts/ops/selftest.sh --sqlite     # 只测 SQLite
#   scripts/ops/selftest.sh --pg         # 只测 PostgreSQL（需要 docker）
#
# 退出码：0 全通过；1 有用例失败；2 用法错误。
set -Eeuo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)
MODE=auto
PASSED=0
FAILED=0

die() { printf '错误：%s\n' "$*" >&2; exit 2; }
log() { printf '[selftest] %s\n' "$*"; }
check() {
  local name=$1 expected=$2 actual=$3
  if [[ "$expected" == "$actual" ]]; then
    printf '  ok   %s\n' "$name"
    PASSED=$((PASSED + 1))
  else
    printf '  FAIL %s（期望 %s，实际 %s）\n' "$name" "$expected" "$actual" >&2
    FAILED=$((FAILED + 1))
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --sqlite) MODE=sqlite; shift ;;
    --pg) MODE=pg; shift ;;
    -h|--help) sed -n '2,18p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "未知参数：$1" ;;
  esac
done

if [[ "$MODE" == auto ]]; then
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then MODE=pg; else MODE=sqlite; fi
fi

WORK=$(mktemp -d "${TMPDIR:-/tmp}/nebula-selftest.XXXXXX")
POSTGRES_CONTAINER=""

cleanup() {
  [[ -n "$POSTGRES_CONTAINER" ]] && docker rm -f "$POSTGRES_CONTAINER" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

BACKUP="$ROOT_DIR/scripts/ops/backup.sh"
RESTORE="$ROOT_DIR/scripts/ops/restore.sh"

# ---------------------------------------------------------------------------
# SQLite
# ---------------------------------------------------------------------------
test_sqlite() {
  log 'SQLite：备份 → 破坏 → 恢复'
  local db="$WORK/nebula.sqlite"
  mkdir -p "$WORK/backups"

  command -v sqlite3 >/dev/null 2>&1 || die '需要 sqlite3 命令才能跑 SQLite 自检'
  sqlite3 "$db" "CREATE TABLE files (id TEXT PRIMARY KEY, size INTEGER); INSERT INTO files VALUES ('f1', 1024);"

  DB_TYPE=sqlite DB_DATABASE="$db" bash "$BACKUP" --out "$WORK/backups" >/dev/null 2>&1
  check '备份产生快照目录' 1 "$(find "$WORK/backups" -maxdepth 1 -mindepth 1 -type d | wc -l | tr -d ' ')"
  check '快照含 MANIFEST' 1 "$(find "$WORK/backups" -name MANIFEST.txt | wc -l | tr -d ' ')"

  # 破坏原库：恢复必须能把数据带回来
  rm -f "$db"
  DB_TYPE=sqlite DB_DATABASE="$db" bash "$RESTORE" "$(ls -d "$WORK"/backups/*/)" >/dev/null 2>&1
  check '恢复后数据完好' 'f1|1024' "$(sqlite3 "$db" 'SELECT id,size FROM files;')"

  # 安全属性 1：目标库非空时拒绝覆盖
  # set -e 下必须显式捕获退出码，否则脚本会先于断言退出
  local code=0
  code=0
  DB_TYPE=sqlite DB_DATABASE="$db" bash "$RESTORE" "$(ls -d "$WORK"/backups/*/)" >/dev/null 2>&1 || code=$?
  check '非空库不加 --force 被拒绝' 1 "$code"

  # 安全属性 2：快照被篡改必须拒绝
  local tampered="$WORK/tampered"
  cp -r "$(ls -d "$WORK"/backups/*/)" "$tampered"
  printf 'x' >> "$tampered/nebula.sqlite"
  code=0
  DB_TYPE=sqlite DB_DATABASE="$WORK/other.sqlite" bash "$RESTORE" "$tampered" >/dev/null 2>&1 || code=$?
  check '篡改快照被 sha256 拒绝' 1 "$code"
}

# ---------------------------------------------------------------------------
# PostgreSQL（真实容器）
# ---------------------------------------------------------------------------
test_pg() {
  log 'PostgreSQL：备份 → 破坏 → 恢复'
  command -v docker >/dev/null 2>&1 || die '需要 docker 才能测试 PostgreSQL 路径'

  local port=55432
  POSTGRES_CONTAINER="nebula-selftest-pg-$$"
  docker run -d --name "$POSTGRES_CONTAINER" \
    -e POSTGRES_PASSWORD=selftest -e POSTGRES_USER=nebula -e POSTGRES_DB=nebula \
    -p "$port":5432 postgres:16-alpine >/dev/null
  for _ in $(seq 1 30); do
    docker exec "$POSTGRES_CONTAINER" pg_isready -U nebula >/dev/null 2>&1 && break
    sleep 1
  done
  docker exec "$POSTGRES_CONTAINER" pg_isready -U nebula >/dev/null 2>&1 || die 'PostgreSQL 未就绪'

  docker exec -e PGPASSWORD=selftest "$POSTGRES_CONTAINER" \
    psql -U nebula -d nebula -c 'CREATE TABLE files (id text primary key, size bigint); INSERT INTO files VALUES ($$f1$$, 1024);' >/dev/null

  mkdir -p "$WORK/backups"
  DB_TYPE=postgres DB_HOST=127.0.0.1 DB_PORT="$port" DB_USERNAME=nebula DB_PASSWORD=selftest DB_DATABASE=nebula \
    bash "$BACKUP" --out "$WORK/backups" >/dev/null 2>&1
  check '备份产生 custom format 文件' 1 "$(find "$WORK/backups" -name 'database.dump' | wc -l | tr -d ' ')"

  docker exec -e PGPASSWORD=selftest "$POSTGRES_CONTAINER" psql -U nebula -d nebula -c 'DROP TABLE files;' >/dev/null
  DB_TYPE=postgres DB_HOST=127.0.0.1 DB_PORT="$port" DB_USERNAME=nebula DB_PASSWORD=selftest DB_DATABASE=nebula \
    bash "$RESTORE" "$(ls -d "$WORK"/backups/*/)" --force >/dev/null 2>&1
  check '恢复后数据完好' 'f1|1024' \
    "$(docker exec -e PGPASSWORD=selftest "$POSTGRES_CONTAINER" psql -tA -U nebula -d nebula -c 'SELECT id,size FROM files;' 2>/dev/null | tr -d '\r')"
}

case "$MODE" in
  sqlite) test_sqlite ;;
  pg) test_pg ;;
esac

printf '\n[selftest] 通过 %d / 共 %d\n' "$PASSED" "$((PASSED + FAILED))"
[[ "$FAILED" -eq 0 ]] || exit 1
