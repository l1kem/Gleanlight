import Fastify from "fastify";
import cookie from "@fastify/cookie";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import type { FastifyStaticOptions } from "@fastify/static";
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
  TRUST_PROXY,
} from "./config.js";
import { authRoutes } from "./routes/auth.js";
import { postRoutes } from "./routes/posts.js";
import { kbRoutes } from "./routes/kb.js";
import { mediaRoutes } from "./routes/media.js";
import { settingsRoutes } from "./routes/settings.js";
import { aiRoutes } from "./routes/ai.js";
import {
  publishRoutes,
  promoteScheduledPosts,
  recoverInterruptedBuilds,
  startPublish,
} from "./routes/publish.js";
import { statsRoutes } from "./routes/stats.js";
import { wikiRoutes } from "./routes/wiki.js";
import { versionRoutes } from "./routes/version.js";
import { requireAuth } from "./auth.js";
import { renderMarkdown, extractToc } from "@gleanlight/markdown";

async function main(): Promise<void> {
  const app = Fastify({
    logger: { transport: undefined, level: process.env.BLOG_LOG ?? "info" },
    bodyLimit: 10 * 1024 * 1024,
    trustProxy: TRUST_PROXY,
  });

  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
    reply.header("X-Frame-Options", "SAMEORIGIN");
    reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    const isSvgMedia =
      (request.url.startsWith("/media/") || request.url.startsWith("/uploads/")) &&
      request.url.split("?")[0].toLowerCase().endsWith(".svg");
    reply.header(
      "Content-Security-Policy",
      isSvgMedia
        ? "default-src 'none'; sandbox"
        : "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob:; frame-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'",
    );
    return payload;
  });

  await app.register(cookie);
  await app.register(jwt, {
    secret: JWT_SECRET(),
    cookie: { cookieName: COOKIE_NAME, signed: false },
    sign: { expiresIn: "7d" },
  });
  await app.register(multipart);

  // ── 媒体/附件文件（编辑器内预览用）──────────────────────────
  // /media/ 与 /uploads/ 是同一目录的两个别名：
  // md 源文里统一写相对路径 uploads/<file>（迁移友好），渲染时补 /
  const mediaStaticOptions = (prefix: string): FastifyStaticOptions => ({
    root: MEDIA_DIR,
    prefix,
    decorateReply: false,
    setHeaders(res, filePath) {
      res.setHeader("X-Content-Type-Options", "nosniff");
      if (filePath.toLowerCase().endsWith(".svg")) {
        res.setHeader("Content-Disposition", "attachment");
        res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
      }
    },
  });
  await app.register(async (mediaApp) => {
    mediaApp.addHook("preHandler", requireAuth);
    await mediaApp.register(fastifyStatic, mediaStaticOptions("/media/"));
    await mediaApp.register(fastifyStatic, mediaStaticOptions("/uploads/"));
  });

  // ── API 路由 ─────────────────────────────────────────────────
  await app.register(
    async (api) => {
      await api.register(rateLimit, {
        global: true,
        max: 300,
        timeWindow: "1 minute",
        keyGenerator: (req) => req.ip,
      });

      // Cookie 会话配合 SameSite=Lax；Origin 存在时再做同源校验，阻断同站伪造写请求。
      api.addHook("onRequest", async (request, reply) => {
        if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
        const origin = request.headers.origin;
        if (!origin) return;
        const forwardedHost = request.headers["x-forwarded-host"];
        const host = (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost) ?? request.headers.host;
        try {
          if (!host || new URL(origin).host !== host) {
            return reply.code(403).send({ error: "拒绝跨站请求" });
          }
        } catch {
          return reply.code(403).send({ error: "请求来源无效" });
        }
      });

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
      if (
        req.url.startsWith("/api") ||
        req.url.startsWith("/media") ||
        req.url.startsWith("/uploads")
      ) {
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
    front.addHook("onSend", async (_request, reply, payload) => {
      reply.header("X-Content-Type-Options", "nosniff");
      reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
      reply.header("X-Frame-Options", "SAMEORIGIN");
      reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
      reply.header(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com; font-src 'self' data: https://cdn.jsdelivr.net https://fonts.gstatic.com; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'",
      );
      return payload;
    });
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

  if (recoverInterruptedBuilds()) {
    app.log.warn("检测到中断或待补跑的发布任务，已重新排队");
    startPublish("scheduled");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
