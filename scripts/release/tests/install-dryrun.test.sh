#!/usr/bin/env bash
# install.sh 的非联网用例：参数解析、dry-run 计划、平台/参数守卫。
# 不下载、不写系统目录，可在任意平台跑；Linux 专属路径由 CI 的 ubuntu 作业覆盖。
set -Eeuo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd -P)
INSTALL="$ROOT_DIR/scripts/install.sh"
PASSED=0
FAILED=0

check() {
  local name=$1 expected=$2 actual=$3
  if [[ "$expected" == "$actual" ]]; then
    printf 'ok   %s\n' "$name"; PASSED=$((PASSED + 1))
  else
    printf 'FAIL %s（期望 %s，实际 %s）\n' "$name" "$expected" "$actual" >&2; FAILED=$((FAILED + 1))
  fi
}

run() { local code=0; "$@" >/dev/null 2>&1 || code=$?; printf '%s' "$code"; }

check '--help 退出 0' 0 "$(run bash "$INSTALL" --help)"
check '--dry-run 退出 0' 0 "$(run bash "$INSTALL" --dry-run --version 0.1.0 --root /tmp/x)"
check '未知参数被拒绝' 1 "$(run bash "$INSTALL" --nope)"

# dry-run 计划必须包含关键信息，避免"静默变成真安装"
plan=$(bash "$INSTALL" --dry-run --version 1.2.3 --root /tmp/nebula-plan 2>&1 || true)
case "$plan" in
  *'安装根目录：/tmp/nebula-plan'*) check '计划包含安装根目录' 0 0 ;;
  *) check '计划包含安装根目录' 0 1 ;;
esac
case "$plan" in
  *'1.2.3'*) check '计划包含指定版本' 0 0 ;;
  *) check '计划包含指定版本' 0 1 ;;
esac
case "$plan" in
  *'验签'*) check '计划声明验签策略' 0 0 ;;
  *) check '计划声明验签策略' 0 1 ;;
esac

# 非 Linux 必须明确拒绝（在 macOS 上这条天然通过；CI 的 ubuntu 上会因 --dry-run 提前返回而跳过）
if [[ "$(uname -s)" != 'Linux' ]]; then
  check '非 Linux 明确拒绝' 1 "$(run bash "$INSTALL" --version 0.1.0)"
fi

printf '\n[install-dryrun] 通过 %d / 共 %d\n' "$PASSED" "$((PASSED + FAILED))"
[[ "$FAILED" -eq 0 ]] || exit 1
