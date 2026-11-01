#!/usr/bin/env bash
# 离线回归：版本解析必须跳过「只有说明、没有发行包」的 Release。
#
# 背景：Release notes 建说明、Release 构建产物，两者有时间差。此前安装脚本直接取
# releases/latest，拿到尚未构建完成的 tag → 下载 404，真实环境首装失败。
set -Eeuo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd -P)
INSTALL="$ROOT_DIR/scripts/install.sh"
PASSED=0
die() { printf 'FAIL %s\n' "$*" >&2; exit 1; }
ok() { printf 'ok   %s\n' "$*"; PASSED=$((PASSED + 1)); }

WORK=$(mktemp -d "${TMPDIR:-/tmp}/nebula-resolver.XXXXXX")
trap 'rm -rf "$WORK"' EXIT

# 取出解析函数（失败即视为脚本结构变化，用例本身要挂）
sed -n '/^resolve_version_with_asset()/,/^}/p' "$INSTALL" > "$WORK/fn.sh"
grep -q 'resolve_version_with_asset' "$WORK/fn.sh" || die 'install.sh 中找不到 resolve_version_with_asset'

# 构造假 curl：
#   - 列表接口返回 3 个 tag（新的 9.9.9 / 9.9.8 都没产物，9.9.7 有产物）
#   - HEAD 探测：9.9.7 返回 200，其余 404
mkdir -p "$WORK/bin"
cat > "$WORK/bin/curl" <<'STUB'
#!/usr/bin/env bash
args="$*"
if [[ "$args" == *"releases?per_page"* ]]; then
  printf '%s\n' '{"tag_name": "v9.9.9"}, {"tag_name": "v9.9.8"}, {"tag_name": "v9.9.7"}'
  exit 0
fi
if [[ "$args" == *"9.9.7-linux-x64.zip"* ]]; then exit 0; fi
if [[ "$args" == *"-I"* || "$args" == *"-IL"* || "$args" == *"-fsIL"* ]]; then exit 22; fi
exit 22
STUB
chmod +x "$WORK/bin/curl"

OUT=$(PATH="$WORK/bin:$PATH" REPO=owner/repo bash -c 'source "$1"; resolve_version_with_asset' _ "$WORK/fn.sh" || true)
[[ "$OUT" == '9.9.7' ]] && ok '跳过无产物的新版本，选中最近的有产物版本' || die "解析结果不符合预期：'$OUT'"

# 全部都没产物 → 必须失败（调用方据此给出可操作提示，而不是拿一个坏版本继续）
cat > "$WORK/bin/curl" <<'STUB'
#!/usr/bin/env bash
args="$*"
if [[ "$args" == *"releases?per_page"* ]]; then
  printf '%s\n' '{"tag_name": "v9.9.9"}'
  exit 0
fi
exit 22
STUB
chmod +x "$WORK/bin/curl"
if PATH="$WORK/bin:$PATH" REPO=owner/repo bash -c 'source "$1"; resolve_version_with_asset' _ "$WORK/fn.sh" >/dev/null 2>&1; then
  die '没有可用产物时应返回失败'
else
  ok '全部版本都没有产物 → 返回失败'
fi

printf '\n[install-resolver] 通过 %d / 共 %d\n' "$PASSED" "$PASSED"
