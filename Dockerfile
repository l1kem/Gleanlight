# ── 构建阶段：安装依赖 + 构建后台 SPA ──────────────────────────
FROM node:22-bookworm-slim AS builder

WORKDIR /app
RUN corepack enable

# 先拷贝清单文件，最大化利用层缓存
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/site/package.json packages/site/
COPY packages/admin/package.json packages/admin/
COPY packages/server/package.json packages/server/
COPY packages/markdown/package.json packages/markdown/
COPY packages/tokens/package.json packages/tokens/
RUN pnpm install --no-frozen-lockfile

COPY . .
# 后台 SPA 构建进 packages/admin/dist（运行时由 Fastify 托管）
RUN pnpm --filter @gleanlight/admin build

# ── 运行阶段 ───────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime

WORKDIR /app
RUN corepack enable

# OG 分享图渲染中文字形（sharp/librsvg 走 fontconfig）。
# 网络不通时跳过：构建继续，仅 OG 图字形退化为方框。
RUN apt-get update \
    && apt-get install -y --no-install-recommends fonts-noto-cjk fontconfig \
    && rm -rf /var/lib/apt/lists/* \
    || echo "[docker] CJK 字体安装失败，OG 图字形将退化"

# 全量拷贝（含依赖与构建产物）：发布动作在容器内执行 astro build，
# 因此 site 包的依赖与源码需随运行时保留
COPY --from=builder /app ./

ENV NODE_ENV=production \
    BLOG_HOST=0.0.0.0 \
    BLOG_PORT=7300 \
    BLOG_DATA_DIR=/data

VOLUME ["/data"]

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 7300
ENTRYPOINT ["/entrypoint.sh"]
