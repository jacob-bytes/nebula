#!/usr/bin/env bash
# 发布后自检的回归用例：用临时 git 仓库 + bare 远程复现四类真实错误。
# 不依赖 Linux/网络（远程是本地 bare 仓库）。
set -Eeuo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd -P)
SCRIPT="$ROOT_DIR/scripts/release/check-release-state.sh"
PASSED=0
FAILED=0

ok() { printf 'ok   %s\n' "$*"; PASSED=$((PASSED + 1)); }
bad() { printf 'FAIL %s\n' "$*" >&2; FAILED=$((FAILED + 1)); }

WORK=$(mktemp -d "${TMPDIR:-/tmp}/nebula-release-check.XXXXXX")
trap 'rm -rf "$WORK"' EXIT

# 造一个带 origin 的仓库，并把自检脚本拷进去（脚本按自身位置找仓库根）
make_repo() {
  local dir=$1
  mkdir -p "$dir/scripts/release"
  cp "$SCRIPT" "$dir/scripts/release/check-release-state.sh"
  chmod +x "$dir/scripts/release/check-release-state.sh"
  printf '0.1.0\n' > "$dir/VERSION"
  git -C "$dir" init -q -b main
  git -C "$dir" config user.email t@example.com
  git -C "$dir" config user.name tester
  git -C "$dir" add -A
  git -C "$dir" commit -qm init
  # bare 远程放在工作区之外：放在里面会被 git status 当成未跟踪文件而误报"工作区脏"
  local remote_dir="${dir}.remote.git"
  git -C "$dir" init -q --bare "$remote_dir"
  git -C "$dir" remote add origin "$remote_dir"
  git -C "$dir" push -q -u origin main
}

run_check() { # dir [args...]
  local dir=$1; shift
  local code=0
  ( cd "$dir" && bash ./scripts/release/check-release-state.sh "$@" ) >/dev/null 2>&1 || code=$?
  printf '%s' "$code"
}

# --- 场景 1：一切正确 ---
D="$WORK/ok"
make_repo "$D"
git -C "$D" tag -a v0.1.0 -m t
git -C "$D" push -q origin v0.1.0
[[ "$(run_check "$D")" == 0 ]] && ok '提交+标签+版本一致 → 通过' || bad '正确状态未被通过'

# --- 场景 2：标签指向旧提交 ---
D="$WORK/stale-tag"
make_repo "$D"
git -C "$D" tag -a v0.1.0 -m t
git -C "$D" push -q origin v0.1.0
printf 'later\n' > "$D/later.txt"
git -C "$D" add -A && git -C "$D" commit -qm later && git -C "$D" push -q
[[ "$(run_check "$D")" == 1 ]] && ok '标签指向旧提交 → 失败' || bad '标签指向旧提交未被发现'

# --- 场景 3：有未推送提交 ---
D="$WORK/unpushed"
make_repo "$D"
git -C "$D" tag -a v0.1.0 -m t
git -C "$D" push -q origin v0.1.0
printf 'local\n' > "$D/local.txt"
git -C "$D" add -A && git -C "$D" commit -qm local-only
[[ "$(run_check "$D")" == 1 ]] && ok '本地领先远程 → 失败' || bad '未推送提交未被发现'

# --- 场景 4：VERSION 与标签不一致 ---
D="$WORK/version-mismatch"
make_repo "$D"
git -C "$D" tag -a v0.1.0 -m t
git -C "$D" push -q origin v0.1.0
printf '0.2.0\n' > "$D/VERSION"
git -C "$D" add -A && git -C "$D" commit -qm bump && git -C "$D" push -q
[[ "$(run_check "$D" --tag v0.1.0)" == 1 ]] && ok 'VERSION 与标签不一致 → 失败' || bad '版本不一致未被发现'

# --- 场景 5：远程缺标签 ---
D="$WORK/no-remote-tag"
make_repo "$D"
git -C "$D" tag -a v0.1.0 -m t     # 只打本地，不推
[[ "$(run_check "$D")" == 1 ]] && ok '远程缺标签 → 失败' || bad '远程缺标签未被发现'

printf '\n[release-state] 通过 %d / 共 %d\n' "$PASSED" "$((PASSED + FAILED))"
[[ "$FAILED" -eq 0 ]] || exit 1
