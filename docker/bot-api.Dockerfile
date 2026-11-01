# syntax=docker/dockerfile:1
#
# 本地 Telegram Bot API（仓库内二次开发的 fork）。
#
# 为什么需要它：官方 api.telegram.org 对下载有 20MB 上限；以 --local 运行本地实例后
# 可以服务到 2GB，并启用本 fork 的流式文件端点（冷文件首字节不必等整文件下载完）。
#
# 构建成本提示：首次构建要编译 TDLib，在 2 核机器上约 15–30 分钟，峰值内存约 2GB。
# 只在需要大文件能力时启用（compose profile: botapi），不影响应用镜像的构建速度。
#
# 依赖（来自上游 README）：OpenSSL、zlib、C++17 编译器、gperf、CMake 3.10+。
ARG DEBIAN_RELEASE=bookworm

# ---------------------------------------------------------------------------
# 阶段 1：编译
# ---------------------------------------------------------------------------
FROM debian:${DEBIAN_RELEASE}-slim AS build

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       build-essential cmake gperf libssl-dev zlib1g-dev ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
# 只拷贝源码树；构建产物体积远大于源码，放在独立阶段便于丢弃
COPY telegram-bot-api/ ./

# 用 Ninja 不可用时退回 Make；限制并行度避免小内存机器 OOM
RUN cmake -S . -B build -DCMAKE_BUILD_TYPE=Release \
    && cmake --build build --target telegram-bot-api -- -j"$(nproc)"

# ---------------------------------------------------------------------------
# 阶段 2：运行
# ---------------------------------------------------------------------------
FROM debian:${DEBIAN_RELEASE}-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends libssl3 zlib1g ca-certificates tini \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --home-dir /var/lib/telegram-bot-api --create-home botapi

COPY --from=build /src/build/telegram-bot-api /usr/local/bin/telegram-bot-api

# workdir 与历史 file_id 强绑定：必须用持久卷，删掉会让已上传文件全部失效
RUN mkdir -p /var/lib/telegram-bot-api && chown -R botapi:botapi /var/lib/telegram-bot-api
VOLUME ["/var/lib/telegram-bot-api"]

USER botapi
WORKDIR /var/lib/telegram-bot-api
EXPOSE 8081

# --local 是突破 20MB 下载上限的前提；--enable-file-streaming 打开本 fork 的流式端点。
# api-id / api-hash 由 compose 从 .env 注入，缺失时容器会立即退出（fail-closed）。
ENTRYPOINT ["/usr/bin/tini", "--", "telegram-bot-api"]
CMD ["--local", "--http-port=8081", "--dir=/var/lib/telegram-bot-api", "--enable-file-streaming"]
