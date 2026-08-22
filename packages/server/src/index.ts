import Fastify from "fastify";
import cookie from "@fastify/cookie";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import fs from "node:fs";
import {
  HOST,
  PORT,
  FRONT_PORT,
  JWT_SECRET,
  COOKIE_NAME,
  MEDIA_DIR,
  ADMIN_DIST,
  PUBLIC_DIST,
  ROOT,
} from "./config.js";
import { authRoutes } from "./routes/auth.js";
import { postRoutes } from "./routes/posts.js";
import { kbRoutes } from "./routes/kb.js";
import { mediaRoutes } from "./routes/media.js";
import { settingsRoutes } from "./routes/settings.js";
import { aiRoutes } from "./routes/ai.js";
import { publishRoutes, promoteScheduledPosts } from "./routes/publish.js";
import { statsRoutes } from "./routes/stats.js";
import { wikiRoutes } from "./routes/wiki.js";
import { versionRoutes } from "./routes/version.js";
import { requireAuth } from "./auth.js";
import { renderMarkdown, extractToc } from "@gleanlight/markdown";

async function main(): Promise<void> {
  const app = Fastify({
    logger: { transport: undefined, level: process.env.BLOG_LOG ?? "info" },
    bodyLimit: 10 * 1024 * 1024,
  });

  await app.register(cookie);
  await app.register(jwt, {
    secret: JWT_SECRET(),
    cookie: { cookieName: COOKIE_NAME, signed: false },
    sign: { expiresIn: "7d" },
  });
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: "1 minute",
    // 仅 API 限速；静态资源不限
    keyGenerator: (req) => `/api${req.url.split("?")[0].replace(/^\/api/, "")}`,
  });
  await app.register(multipart);

  // ── 媒体/附件文件（编辑器内预览用）──────────────────────────
  // /media/ 与 /uploads/ 是同一目录的两个别名：
  // md 源文里统一写相对路径 uploads/<file>（迁移友好），渲染时补 /
  await app.register(fastifyStatic, {
    root: MEDIA_DIR,
    prefix: "/media/",
    decorateReply: false,
  });
  await app.register(fastifyStatic, {
    root: MEDIA_DIR,
    prefix: "/uploads/",
    decorateReply: false,
  });

  // ── API 路由 ─────────────────────────────────────────────────
  await app.register(
    async (api) => {
      // 各业务路由模块内部已自带 requireAuth 守卫；auth 组自行处理登录态
      await api.register(authRoutes, { prefix: "/auth" });
      await api.register(postRoutes);
      await api.register(kbRoutes);
      await api.register(mediaRoutes);
      await api.register(settingsRoutes);
      await api.register(aiRoutes);
      await api.register(publishRoutes);
      await api.register(statsRoutes);
      await api.register(wikiRoutes);
      await api.register(versionRoutes);

      // Markdown 预览（与前台渲染同规则）
      api.post(
        "/preview",
        { preHandler: requireAuth },
        async (request) => {
          const { md } = (request.body ?? {}) as { md?: string };
          return { html: renderMarkdown(md ?? ""), toc: extractToc(md ?? "") };
        }
      );
    },
    { prefix: "/api" }
  );

  // ── 生产模式：托管 admin SPA（构建产物）──────────────────────
  if (fs.existsSync(ADMIN_DIST)) {
    await app.register(fastifyStatic, {
      root: ADMIN_DIST,
      prefix: "/",
      decorateReply: true,
    });
    app.setNotFoundHandler(async (req, reply) => {
      if (req.url.startsWith("/api") || req.url.startsWith("/media")) {
        return reply.code(404).send({ error: "Not Found" });
      }
      return reply.sendFile("index.html", ADMIN_DIST);
    });
  }

  await app.listen({ host: HOST, port: PORT });
  app.log.info(`Gleanlight 已启动：http://${HOST}:${PORT}`);
  app.log.info(`仓库根目录：${ROOT}`);

  // ── 前台静态站：独立端口托管 public-dist，发布后即更新 ────────
  // 部署时可只放行此端口对外，后台端口留在防火墙内。
  if (FRONT_PORT > 0) {
    const front = Fastify({ logger: false });
    if (fs.existsSync(PUBLIC_DIST)) {
      await front.register(fastifyStatic, { root: PUBLIC_DIST, prefix: "/" });
      front.setNotFoundHandler(async (req, reply) => {
        // 带扩展名的资源路径直接 404，页面路径回退到首页
        if (/\.[a-zA-Z0-9]+$/.test(req.url.split("?")[0])) {
          return reply.code(404).send("Not Found");
        }
        return reply.sendFile("index.html");
      });
    } else {
      front.get("/", async (_req, reply) =>
        reply
          .type("text/html; charset=utf-8")
          .send(
            "<!doctype html><meta charset='utf-8'><title>拾光集</title>" +
              "<p>前台还没有内容：到后台点一次「发布」，然后刷新本页。</p>"
          )
      );
    }
    await front.listen({ host: HOST, port: FRONT_PORT });
    app.log.info(`前台静态站：http://${HOST}:${FRONT_PORT}`);
  }

  // 定时发布扫描：每分钟检查到点的定时草稿 → 转已发布并触发构建
  const timer = setInterval(() => {
    try {
      promoteScheduledPosts();
    } catch (err) {
      app.log.error({ err }, "定时发布扫描失败");
    }
  }, 60_000);
  timer.unref?.();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
