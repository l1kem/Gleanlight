#!/bin/sh
# Gleanlight 容器入口：数据卷就绪 → 首次启动初始化 → 启动服务
set -e

DATA_DIR="${BLOG_DATA_DIR:-/data}"
mkdir -p "$DATA_DIR"

# 首次启动：无数据库时初始化账号与示例内容（幂等，已有数据则跳过）
if [ ! -f "$DATA_DIR/blog.db" ]; then
  echo "[entrypoint] 未发现数据库，执行首次初始化 …"
  if [ -n "$ADMIN_PASSWORD" ]; then
    pnpm --filter @gleanlight/server seed -- --username "${ADMIN_USER:-admin}" --password "$ADMIN_PASSWORD"
  else
    # 随机密码只打印一次（docker logs 查看）
    pnpm --filter @gleanlight/server seed -- --username "${ADMIN_USER:-admin}"
  fi
fi

echo "[entrypoint] Gleanlight starting on ${BLOG_HOST:-0.0.0.0}:${BLOG_PORT:-7300}"
exec pnpm --filter @gleanlight/server start
