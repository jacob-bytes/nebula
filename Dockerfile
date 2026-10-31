# syntax=docker/dockerfile:1

# ============================================================================
# 星云盘（nebula）生产镜像
#
# 三阶段构建：前端产物 → 后端编译产物（含生产依赖）→ 精简运行时。
# 运行时镜像内布局与后端代码的路径探测保持一致：
#   /app/backend/dist/main.js          后端入口（__dirname = /app/backend/dist）
#   /app/frontend/dist/index.html      前端产物（main.ts 探测 ../../frontend/dist）
#   /app/backend/tmp/                  缓存与日志（process.cwd() = /app/backend）
#
# 不使用自更新模块：升级通过替换镜像完成。
# ============================================================================

ARG NODE_VERSION=22

# ---------------------------------------------------------------------------
# 阶段 1：前端构建
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS frontend-build
WORKDIR /build/frontend

# 先只拷贝清单，最大化利用层缓存
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY frontend/ ./
# vue-tsc 类型检查 + vite 构建都由 build 脚本串起来，失败即中断镜像构建
RUN npm run build


# ---------------------------------------------------------------------------
# 阶段 2：后端构建（含原生模块编译工具链与生产依赖裁剪）
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS backend-build
WORKDIR /build/backend

# sqlite3 / sharp 在缺少预编译包时需要源码编译；build-essential 只在构建阶段存在，
# 不会进入最终镜像。
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY backend/package.json backend/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY backend/ ./
RUN npm run build \
    && npm prune --omit=dev \
    && npm cache clean --force


# ---------------------------------------------------------------------------
# 阶段 3：运行时
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime

ENV NODE_ENV=production \
    APP_HOST=0.0.0.0 \
    APP_PORT=3000 \
    LOG_DIR=tmp/logs

RUN apt-get update \
    && apt-get install -y --no-install-recommends tini ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 后端（编译产物 + 生产依赖）
COPY --from=backend-build --chown=node:node /build/backend/dist ./backend/dist
COPY --from=backend-build --chown=node:node /build/backend/node_modules ./backend/node_modules
COPY --from=backend-build --chown=node:node /build/backend/package.json ./backend/package.json

# 前端静态产物
COPY --from=frontend-build --chown=node:node /build/frontend/dist ./frontend/dist

# 启动脚本
COPY --chown=node:node docker/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh \
    && mkdir -p /app/backend/tmp/logs /app/backend/tmp/Cache \
    && chown -R node:node /app/backend/tmp

USER node
WORKDIR /app/backend

EXPOSE 3000

# 健康检查复用应用自身的 /api/health（不引入 curl，减小镜像体积）
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.APP_PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--", "/app/entrypoint.sh"]
