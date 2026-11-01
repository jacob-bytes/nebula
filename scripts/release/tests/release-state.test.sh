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

# 环境隔离：CI runner 可能有 commit.gpgsign / init.defaultBranch / 全局 hooks 等配置，
# 会让临时仓库的 commit/push 行为与本机不同。这里禁用全局与系统配置，并显式给身份。
export GIT_CONFIG_GLOBAL=/dev/null
export GIT_CONFIG_SYSTEM=/dev/null
export GIT_CONFIG_NOSYSTEM=1
# 独立 HOME：避免 runner 的 ~/.gitconfig / 模板影响临时仓库
export HOME="$WORK/home"
mkdir -p "$HOME"
# 允许基于本地路径的 push/ls-remote（部分 git 版本对 file 协议有额外限制）
export GIT_ALLOW_PROTOCOL=file:https:ssh
export GIT_AUTHOR_NAME=tester GIT_AUTHOR_EMAIL=t@example.com
export GIT_COMMITTER_NAME=tester GIT_COMMITTER_EMAIL=t@example.com
export GIT_TERMINAL_PROMPT=0

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
  local code=0 out
  out=$( cd "$dir" && bash ./scripts/release/check-release-state.sh "$@" 2>&1 ) || code=$?
  # 保留最后一次输出：某条用例与预期不符时，CI 日志里能直接看到是哪一项 FAIL
  printf '%s\n' "$out" > "${dir}.last-check.log"
  printf '%s' "$code"
}

# 用例不符合预期时把自检输出打到 stderr，便于在 CI 日志里定位
dump_check() {
  local dir=$1
  [[ -f "${dir}.last-check.log" ]] || return 0
  sed 's/^/      /' "${dir}.last-check.log" >&2
  # 在 GitHub Actions 里把细节写进 check-run 注解：CI 日志需要权限，
  # 而注解可以通过公开 API 读取，便于在无凭据环境定位失败原因
  if [[ "${GITHUB_ACTIONS:-}" == 'true' ]]; then
    while IFS= read -r line; do
      [[ -n "$line" ]] || continue
      printf '::error title=release-state::%s\n' "$line"
    done < "${dir}.last-check.log"
  fi
}

# --- 场景 1：一切正确 ---
D="$WORK/ok"
make_repo "$D"
git -C "$D" tag -a v0.1.0 -m t
git -C "$D" push -q origin v0.1.0
if [[ "$(run_check "$D")" == 0 ]]; then ok '提交+标签+版本一致 → 通过'; else bad '正确状态未被通过'; dump_check "$D"; fi

# --- 场景 2：标签指向旧提交 ---
D="$WORK/stale-tag"
make_repo "$D"
git -C "$D" tag -a v0.1.0 -m t
git -C "$D" push -q origin v0.1.0
printf 'later\n' > "$D/later.txt"
git -C "$D" add -A && git -C "$D" commit -qm later && git -C "$D" push -q
if [[ "$(run_check "$D")" == 1 ]]; then ok '标签指向旧提交 → 失败'; else bad '标签指向旧提交未被发现'; dump_check "$D"; fi

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
if [[ "$(run_check "$D" --tag v0.1.0)" == 1 ]]; then ok 'VERSION 与标签不一致 → 失败'; else bad '版本不一致未被发现'; dump_check "$D"; fi

# --- 场景 5：远程缺标签 ---
D="$WORK/no-remote-tag"
make_repo "$D"
git -C "$D" tag -a v0.1.0 -m t     # 只打本地，不推
if [[ "$(run_check "$D")" == 1 ]]; then ok '远程缺标签 → 失败'; else bad '远程缺标签未被发现'; dump_check "$D"; fi

printf '\n[release-state] 通过 %d / 共 %d\n' "$PASSED" "$((PASSED + FAILED))"
[[ "$FAILED" -eq 0 ]] || exit 1
