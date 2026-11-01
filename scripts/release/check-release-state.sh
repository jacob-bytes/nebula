#!/usr/bin/env bash
# 发布后自检：确认「提交、标签、版本号、远程」四者一致。
#
# 为什么需要它：曾发生过一次真实事故——`v0.28.0` 的标签被推到了上一个版本的提交上，
# 而本地根本没生成提交，发布流水线因此构建的是旧代码。这类错误的共同点是
# **本地看起来成功了**，只有把远程状态拉出来比对才能发现。
#
# 检查项：
#   1. 工作区干净（没有未提交改动）
#   2. 本地 HEAD 与远程分支一致
#   3. 标签存在（本地 + 远程），且剥离后指向本地 HEAD
#   4. VERSION 与标签版本号一致
#
# 用法：
#   scripts/release/check-release-state.sh              # 用 v$(cat VERSION) 作为标签
#   scripts/release/check-release-state.sh --tag v1.2.3
#   scripts/release/check-release-state.sh --allow-dirty  # 只查标签（例如发版说明刚改）
#
# 退出码：0 通过；1 有一项不一致；2 用法错误。
set -Eeuo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)
TAG=''
REMOTE=origin
ALLOW_DIRTY=0
PASSED=0
FAILED=0

die() { printf '[release-check] 错误：%s\n' "$*" >&2; exit 2; }
log() { printf '[release-check] %s\n' "$*"; }
ok() { printf '  ok   %s\n' "$*"; PASSED=$((PASSED + 1)); }
bad() { printf '  FAIL %s\n' "$*" >&2; FAILED=$((FAILED + 1)); }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag) TAG=${2:?--tag 需要版本号}; shift 2 ;;
    --remote) REMOTE=${2:?--remote 需要远程名}; shift 2 ;;
    --allow-dirty) ALLOW_DIRTY=1; shift ;;
    -h|--help) sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "未知参数：$1" ;;
  esac
done

cd "$ROOT_DIR"
git rev-parse --git-dir >/dev/null 2>&1 || die '当前目录不是 git 仓库'

VERSION=$(tr -d '[:space:]' < VERSION)
[[ -n "$TAG" ]] || TAG="v$VERSION"

# ---- 1. 工作区干净 --------------------------------------------------------
if [[ "$ALLOW_DIRTY" == 1 ]]; then
  log '跳过工作区检查（--allow-dirty）'
else
  if [[ -z "$(git status --porcelain)" ]]; then
    ok '工作区干净'
  else
    bad '工作区有未提交改动（提交后再发布，或用 --allow-dirty 跳过）'
  fi
fi

# ---- 2. 本地 HEAD 与远程一致 ---------------------------------------------
if git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
  LOCAL_HEAD=$(git rev-parse HEAD)
  UPSTREAM_HEAD=$(git rev-parse '@{u}' 2>/dev/null || true)
  if [[ "$LOCAL_HEAD" == "$UPSTREAM_HEAD" ]]; then
    ok "本地 HEAD 与上游一致（$(git rev-parse --short HEAD)）"
  else
    bad "本地 HEAD（$(git rev-parse --short HEAD)）与上游（${UPSTREAM_HEAD:0:7}）不一致，请先推送"
  fi
else
  bad '当前分支没有上游分支（先 git push -u）'
fi

# ---- 3. 标签存在且指向 HEAD ----------------------------------------------
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  TAG_COMMIT=$(git rev-parse "$TAG^{}")
  if [[ "$TAG_COMMIT" == "$(git rev-parse HEAD)" ]]; then
    ok "标签 $TAG 指向本地 HEAD"
  else
    bad "标签 $TAG 指向 ${TAG_COMMIT:0:7}，不是 HEAD（$(git rev-parse --short HEAD)）——发布会构建旧代码"
  fi
else
  bad "本地缺少标签 $TAG"
fi

# 远程标签：用 ls-remote 拉真相，避免依赖本地缓存
REMOTE_REFS=$(git ls-remote --tags "$REMOTE" 2>/dev/null || true)
if [[ -z "$REMOTE_REFS" ]]; then
  bad "无法读取远程 $REMOTE 的标签（网络或权限问题）"
else
  REMOTE_TAG_COMMIT=$(printf '%s\n' "$REMOTE_REFS" | awk -v t="refs/tags/$TAG^{}" '$2 == t { print $1 }')
  if [[ -z "$REMOTE_TAG_COMMIT" ]]; then
    # 轻量标签没有 ^{} 行：退回直接匹配
    REMOTE_TAG_COMMIT=$(printf '%s\n' "$REMOTE_REFS" | awk -v t="refs/tags/$TAG" '$2 == t { print $1 }')
  fi
  if [[ -z "$REMOTE_TAG_COMMIT" ]]; then
    bad "远程缺少标签 ${TAG}（git push origin ${TAG}）"
  elif [[ "$REMOTE_TAG_COMMIT" == "$(git rev-parse HEAD)" ]]; then
    ok "远程标签 $TAG 指向 HEAD"
  else
    bad "远程标签 $TAG 指向 ${REMOTE_TAG_COMMIT:0:7}，与本地 HEAD 不一致（可能需要 force 更新标签）"
  fi
fi

# ---- 4. VERSION 与标签一致 -----------------------------------------------
EXPECTED="v$VERSION"
if [[ "$TAG" == "$EXPECTED" ]]; then
  ok "VERSION（${VERSION}）与标签一致"
else
  bad "VERSION（${VERSION}）与标签（${TAG}）不一致"
fi

printf '\n[release-check] 通过 %d / 共 %d\n' "$PASSED" "$((PASSED + FAILED))"
if [[ "$FAILED" -gt 0 ]]; then
  cat >&2 <<'EOF'

修复建议：
  - 提交未推：git push
  - 标签指错提交：git tag -d <tag> && git tag -a <tag> -m "..." && git push --force origin <tag>
  - 忘记打标签：git tag -a <tag> -m "..." && git push origin <tag>
EOF
  exit 1
fi
