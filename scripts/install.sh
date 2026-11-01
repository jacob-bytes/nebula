#!/usr/bin/env bash
# 星云盘一键安装（非 Docker / systemd 发行包）
#
#   curl -fsSL https://raw.githubusercontent.com/jacob-bytes/nebula/main/scripts/install.sh | sudo bash
#   sudo ./install.sh --version 0.22.0 --yes
#
# 它做的事：下载发行包 → **验签** → 解压到 <root>/releases/<版本> → 原子切换 current
#            → 调用发行包内的 start.sh（首次部署 / 配置 / 安装 systemd 单元 / 启动）
#
# 设计约束：
# - 验签默认强制。--insecure-skip-verify 只在离线调试时使用，会打印显著警告。
# - 失败即中止且不切换 current：宁可没装，也不要留一个半成品安装。
# - 不安装 PostgreSQL/Redis（默认 SQLite 免数据库；Redis 由 start.sh 在需要时处理）。
# - 不配置反向代理与证书：留给使用者按自己的入口方案处理。
set -Eeuo pipefail

REPO=${NEBULA_REPO:-jacob-bytes/nebula}
ROOT=${NEBULA_INSTALL_ROOT:-/opt/nebula}
VERSION=''
ARCHIVE=''
PUBKEY=''
NONINTERACTIVE=0
DEFER_CONFIG=0
DRY_RUN=0
SKIP_VERIFY=0
FORCE=0

log() { printf '[install] %s\n' "$*" >&2; }
die() { printf '[install] 错误：%s\n' "$*" >&2; exit 1; }

# 取「确实带发行包」的最新版本。
#
# GitHub 的 releases/latest 会把「只有发版说明」的 Release 也算作最新——我们的流水线里
# Release notes 建说明、Release 构建产物，两者有时间差，直接取 latest 会 404。
# 这里按时间倒序遍历 Release，逐个用 HEAD 探测 zip 是否存在，命中即返回。
resolve_version_with_asset() {
  local tags v
  tags=$(curl -fsSL --max-time 30 "https://api.github.com/repos/$REPO/releases?per_page=30" 2>/dev/null \
    | grep -oE '"tag_name"[[:space:]]*:[[:space:]]*"v?[0-9]+\.[0-9]+\.[0-9]+"' \
    | sed -E 's/.*"v?([0-9]+\.[0-9]+\.[0-9]+)"$/\1/')
  [[ -n "$tags" ]] || return 1
  for v in $tags; do
    if curl -fsIL --max-time 25 -o /dev/null \
      "https://github.com/$REPO/releases/download/v$v/nebula-v$v-linux-x64.zip" 2>/dev/null; then
      printf '%s' "$v"
      return 0
    fi
  done
  return 1
}


usage() {
  cat <<'EOF'
用法：install.sh [选项]

  --version X.Y.Z        指定版本（默认：GitHub 最新正式 Release）
  --archive PATH|URL     使用已有发行包（离线安装 / 内网镜像）
  --root DIR             安装根目录（默认 /opt/nebula）
  --public-key PATH      覆盖验签公钥（默认从对应 tag 拉取 scripts/release/update-public-key.pem）
  --yes                  非交互安装，配置取自 NEBULA_* 环境变量
  --defer-config         安装阶段不收集任何配置：应用以未初始化状态启动，
                         首次访问 /setup 在浏览器里完成（终端会打印一次性令牌）
  --force                current 已存在时强制切换（默认拒绝，避免覆盖现有安装）
  --insecure-skip-verify 跳过验签（仅离线调试；正式环境禁止）
  --dry-run              只打印计划，不下载、不写入（可在非 Linux 上运行）
  -h, --help             显示本帮助

非交互安装的必填环境变量：
  NEBULA_TELEGRAM_BOT_TOKEN=<bot_id>:<token>
  NEBULA_TELEGRAM_CHAT_ID=-1001234567890

可选：NEBULA_DB_TYPE=sqlite|postgres、NEBULA_APP_URL、NEBULA_DB_PASSWORD（postgres 必填）、
      NEBULA_REDIS_HOST/PORT、NEBULA_TELEGRAM_API_ID/HASH（提供则启用内置 Bot API）

安装完成后：
  - 访问 http://<主机>:3000 注册第一个账号（自动成为超级管理员）
  - 后续升级：<root>/current/scripts/release/upgrade.sh <新发行包.zip>
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) VERSION=${2:?--version 需要版本号}; shift 2 ;;
    --archive) ARCHIVE=${2:?--archive 需要路径或 URL}; shift 2 ;;
    --root) ROOT=${2:?--root 需要目录}; shift 2 ;;
    --public-key) PUBKEY=${2:?--public-key 需要文件路径}; shift 2 ;;
    --yes|-y) NONINTERACTIVE=1; shift ;;
    --defer-config) DEFER_CONFIG=1; shift ;;
    --force) FORCE=1; shift ;;
    --insecure-skip-verify) SKIP_VERIFY=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "未知参数：$1（--help 查看用法）" ;;
  esac
done

ROOT=${ROOT%/}
[[ -n "$ROOT" ]] || die '--root 不能为空'

# dry-run 放在平台检查之前：让 macOS / CI 也能校验参数解析与计划输出
if [[ "$DRY_RUN" == 1 ]]; then
  cat <<EOF
[install] 计划（dry-run）：
  安装根目录：$ROOT
  版本        ：${VERSION:-<最新正式 Release>}
  发行包来源  ：${ARCHIVE:-https://github.com/$REPO/releases/download/<tag>/nebula-<tag>-linux-x64.zip}
  验签        ：$([[ "$SKIP_VERIFY" == 1 ]] && echo '跳过（--insecure-skip-verify）' || echo '强制：SHA256SUMS.sig + 内置公钥')
  配置模式    ：$([[ "$DEFER_CONFIG" == 1 ]] && echo '向导（安装零提问，首次访问 /setup 配置）' || { [[ "$NONINTERACTIVE" == 1 ]] && echo '非交互（NEBULA_* 环境变量）' || echo '交互式（逐项提问）'; })
  目标路径    ：$ROOT/releases/<版本> + $ROOT/current 符号链接
  随后执行    ：$ROOT/current/start.sh$([[ "$DEFER_CONFIG" == 1 ]] && echo ' --setup' || { [[ "$NONINTERACTIVE" == 1 ]] && echo ' --yes' || echo ''; })
  不会做      ：安装 PostgreSQL/Redis、配置反向代理或证书
EOF
  exit 0
fi

# ---- 平台与依赖 -----------------------------------------------------------
[[ "$(uname -s)" == Linux ]] || die "仅支持 Linux（当前：$(uname -s)）；Docker 部署请改用 docker compose"
for cmd in curl unzip openssl tar sha256sum; do
  command -v "$cmd" >/dev/null 2>&1 || die "缺少必需命令：${cmd}（Debian/Ubuntu: apt-get install -y curl unzip openssl tar coreutils）"
done
[[ "$(id -u)" -eq 0 ]] || die '需要 root 权限（sudo ./install.sh ...）'

WORK=$(mktemp -d "${TMPDIR:-/tmp}/nebula-install.XXXXXX")
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

# ---- 解析版本 -------------------------------------------------------------
if [[ -z "$VERSION" ]]; then
  if [[ -n "$ARCHIVE" && "$ARCHIVE" != http* ]]; then
    # 离线包：从文件名推断 nebula-vX.Y.Z-linux-x64.zip
    VERSION=$(basename "$ARCHIVE" | sed -n 's/^nebula-v\(.*\)-linux-x64\.zip$/\1/p')
    [[ -n "$VERSION" ]] || die "无法从文件名推断版本：${ARCHIVE}（请显式传 --version）"
  else
    log '查询最新正式 Release（跳过尚未构建出产物的版本）…'
    VERSION=$(resolve_version_with_asset) || VERSION=''
    if [[ -z "$VERSION" ]]; then
      die '找不到包含发行包的最新 Release（可能都在构建中）。可用 --version 指定版本，或稍后重试'
    fi
    log "选用版本：$VERSION"
  fi
fi
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+ ]] || die "版本号不合法：$VERSION"
TAG="v$VERSION"
log "目标版本：$VERSION"

RELEASE_DIR="$ROOT/releases/$VERSION"
if [[ -e "$RELEASE_DIR" ]]; then
  die "目标版本目录已存在：${RELEASE_DIR}（该版本可能已安装；升级请用 upgrade.sh）"
fi
if [[ -L "$ROOT/current" && "$FORCE" != 1 ]]; then
  existing=$(readlink -f "$ROOT/current" 2>/dev/null || printf '?')
  die "$ROOT/current 已存在（现有安装：${existing}）。确认要用本版本替换请加 --force；常规升级请使用 upgrade.sh。"
fi

# ---- 获取发行包与校验材料 -------------------------------------------------
ZIP="$WORK/nebula-v$VERSION-linux-x64.zip"
SUMS="$WORK/SHA256SUMS"
SIG="$WORK/SHA256SUMS.sig"

fetch() { # url dest
  log "下载 $(basename "$2")"
  curl -fsSL --retry 3 --max-time 300 -o "$2" "$1" || die "下载失败：$1"
}

if [[ -n "$ARCHIVE" ]]; then
  if [[ "$ARCHIVE" == http* ]]; then
    fetch "$ARCHIVE" "$ZIP"
  else
    [[ -f "$ARCHIVE" ]] || die "发行包不存在：$ARCHIVE"
    cp -- "$ARCHIVE" "$ZIP"
  fi
  # 离线安装：校验材料与发行包同目录（缺失时只有 --insecure-skip-verify 才能继续）
  ASSET_BASE=$(dirname "${ARCHIVE}")
  cp -f "$ASSET_BASE/SHA256SUMS" "$SUMS" 2>/dev/null || true
  cp -f "$ASSET_BASE/SHA256SUMS.sig" "$SIG" 2>/dev/null || true
else
  BASE="https://github.com/$REPO/releases/download/$TAG"
  # 指定版本可能仍在构建：先探测，避免用户看到裸的 curl 404
  if ! curl -fsIL --max-time 25 -o /dev/null "$BASE/nebula-v$VERSION-linux-x64.zip" 2>/dev/null; then
    die "v$VERSION 还没有可下载的发行包（可能仍在构建）。可改用上一个已发布版本，或稍后重试"
  fi
  fetch "$BASE/nebula-v$VERSION-linux-x64.zip" "$ZIP"
  fetch "$BASE/SHA256SUMS" "$SUMS"
  fetch "$BASE/SHA256SUMS.sig" "$SIG"
fi

# ---- 验签 -----------------------------------------------------------------
if [[ "$SKIP_VERIFY" == 1 ]]; then
  log '警告：已跳过验签（--insecure-skip-verify）。仅限离线调试，正式环境禁止。'
else
  [[ -s "$SUMS" && -s "$SIG" ]] || die '缺少 SHA256SUMS 或 SHA256SUMS.sig，无法验签（离线包请一并提供，或临时使用 --insecure-skip-verify）'

  if [[ -z "$PUBKEY" ]]; then
    PUBKEY="$WORK/update-public-key.pem"
    fetch "https://raw.githubusercontent.com/$REPO/$TAG/scripts/release/update-public-key.pem" "$PUBKEY"
    log "公钥指纹（SHA256）：$(sha256sum "$PUBKEY" | awk '{print $1}')"
    log '请与仓库 scripts/release/update-public-key.pem 的指纹核对；不一致立即中止。'
  fi
  openssl dgst -sha256 -verify "$PUBKEY" -signature "$SIG" "$SUMS" >/dev/null 2>&1 \
    || die 'SHA256SUMS 验签失败：发行包可能被篡改或公钥不匹配，已中止'

  ( cd "$WORK" && grep -F "$(basename "$ZIP")" "$SUMS" | sha256sum -c --status - ) \
    || die '发行包 sha256 与 SHA256SUMS 不一致，已中止'
  log '验签与 sha256 校验通过'
fi

# ---- 解压与落位 -----------------------------------------------------------
STAGE="$WORK/unpack"
mkdir -p "$STAGE"
unzip -q "$ZIP" -d "$STAGE" || die '解压失败'
mapfile -t tops < <(find "$STAGE" -mindepth 1 -maxdepth 1 -type d)
[[ ${#tops[@]} -eq 1 ]] || die "发行包必须恰有一个顶层目录（实际 ${#tops[@]} 个）"
TOP=${tops[0]}
[[ -f "$TOP/VERSION" ]] || die '发行包缺少 VERSION'
PKG_VERSION=$(tr -d '\r\n' < "$TOP/VERSION")
[[ "$PKG_VERSION" == "$VERSION" ]] || die "发行包内版本($PKG_VERSION) 与请求版本($VERSION) 不一致"

# 发行包布局：start.sh 在包根，运维脚本在 scripts/release/ 下（upgrade/rollback/common 等）
for required in backend/dist/main.js runtime/bin/node start.sh scripts/release/upgrade.sh; do
  [[ -e "$TOP/$required" ]] || die "发行包缺少关键文件：$required"
done

install -d -m 0755 "$ROOT/releases"
mv -- "$TOP" "$RELEASE_DIR"
chmod 0755 "$RELEASE_DIR"
log "已解压到 $RELEASE_DIR"

# 原子切换 current：先建临时链接再 mv -T，避免出现「指向不存在目录」的瞬间
ln -s "releases/$VERSION" "$ROOT/.current.new"
mv -Tf "$ROOT/.current.new" "$ROOT/current"
log "current → releases/$VERSION"

# ---- 交给发行包内的首次部署脚本 -------------------------------------------
START="$ROOT/current/start.sh"
if [[ "$DEFER_CONFIG" == 1 ]]; then
  log '进入向导模式（start.sh --setup）：安装阶段不收集配置'
  bash "$START" --setup
elif [[ "$NONINTERACTIVE" == 1 ]]; then
  log '进入非交互首次部署（start.sh --yes）'
  bash "$START" --yes
else
  log '进入首次部署向导（start.sh）。若需无人值守，请加 --yes 并设置 NEBULA_* 环境变量。'
  bash "$START"
fi

cat >&2 <<EOF

[install] 安装完成。
  安装根目录：$ROOT
  当前版本  ：${VERSION}（$ROOT/current）
  访问地址  ：${NEBULA_APP_URL:-http://<主机>:3000}
  首次使用  ：注册的第一个账号会自动成为超级管理员
  后续升级  ：$ROOT/current/scripts/release/upgrade.sh <新发行包.zip>
EOF
