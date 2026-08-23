import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { db } from "../db.js";
import { requireAuth } from "../auth.js";
import { MEDIA_DIR } from "../config.js";

const ALLOWED = new Set([
  // 图片
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/bmp",
  // 文档（web 版 Obsidian 的附件体系）
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // docx
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // xlsx
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // pptx
  "text/plain",
  "text/csv",
  "text/markdown",
  "application/zip",
  "application/json",
  "application/octet-stream", // 无法识别时的兜底（大小/类型仍受入口限制）
]);

/** octet-stream 兜底时的扩展名白名单（防任意文件上传） */
const SAFE_EXTS = new Set([
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".zip", ".txt", ".csv", ".md", ".json", ".mp3", ".mp4", ".mov",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".bmp",
]);

export async function mediaRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/media", async (request) => {
    const q = request.query as { q?: string };
    if (q.q) {
      return {
        items: db
          .prepare("SELECT * FROM media WHERE filename LIKE ? ORDER BY id DESC")
          .all(`%${q.q}%`),
      };
    }
    return { items: db.prepare("SELECT * FROM media ORDER BY id DESC LIMIT 500").all() };
  });

  app.post("/media", async (request, reply) => {
    const file = await request.file({ limits: { fileSize: 20 * 1024 * 1024 } });
    if (!file) return reply.code(400).send({ error: "未收到文件" });
    const ext = path.extname(file.filename).toLowerCase();
    if (ext === ".svg" || file.mimetype === "image/svg+xml") {
      return reply.code(415).send({ error: "为避免脚本型 SVG，请先转为 PNG、WebP 或 AVIF" });
    }
    if (file.mimetype === "application/octet-stream" && !SAFE_EXTS.has(ext)) {
      return reply.code(415).send({ error: `不支持的文件类型：${ext || "未知"}` });
    }
    if (!ALLOWED.has(file.mimetype)) {
      return reply.code(415).send({ error: `不支持的类型：${file.mimetype}` });
    }
    const storedExt = ext || mimeExt(file.mimetype);
    const stored = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}${storedExt}`;
    const target = path.join(MEDIA_DIR, stored);
    const buffer = await file.toBuffer();
    await fs.promises.writeFile(target, buffer);
    const info = db
      .prepare("INSERT INTO media(filename, stored_name, mime, size) VALUES(?,?,?,?)")
      .run(file.filename, stored, file.mimetype, buffer.byteLength);
    return reply.code(201).send({
      id: Number(info.lastInsertRowid),
      url: `/media/${stored}`,
      filename: file.filename,
      stored_name: stored,
    });
  });

  app.delete("/media/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = db.prepare("SELECT * FROM media WHERE id = ?").get(Number(id)) as
      | { stored_name: string }
      | undefined;
    if (!row) return reply.code(404).send({ error: "文件不存在" });
    db.prepare("DELETE FROM media WHERE id = ?").run(Number(id));
    await fs.promises.rm(path.join(MEDIA_DIR, row.stored_name), { force: true });
    return { ok: true };
  });

  // ── 引用关系：扫描全部文章正文里的 /media/ 引用 ──────────────
  function computeUsage(): Map<number, { id: number; title: string }[]> {
    const posts = db
      .prepare("SELECT id, title, content_md FROM posts")
      .all() as { id: number; title: string; content_md: string }[];
    const media = db.prepare("SELECT id, stored_name FROM media").all() as {
      id: number;
      stored_name: string;
    }[];
    const usage = new Map<number, { id: number; title: string }[]>();
    for (const m of media) usage.set(m.id, []);
    for (const p of posts) {
      for (const m of media) {
        if (p.content_md.includes(m.stored_name)) usage.get(m.id)?.push({ id: p.id, title: p.title });
      }
    }
    return usage;
  }

  app.get("/media/usage", async () => {
    const usage = computeUsage();
    const items = (db.prepare("SELECT * FROM media ORDER BY id DESC").all() as MediaRow[]).map(
      (m) => ({ ...m, refs: usage.get(m.id) ?? [] })
    );
    return { items, unusedCount: items.filter((m) => m.refs.length === 0).length };
  });

  // 批量清理未引用图片（服务端二次校验，被引用的拒绝删除）
  app.post("/media/cleanup", async (request) => {
    const { ids } = (request.body ?? {}) as { ids?: number[] };
    if (!Array.isArray(ids) || ids.length === 0) return { deleted: 0 };
    const usage = computeUsage();
    const del = db.prepare("DELETE FROM media WHERE id = ?");
    let deleted = 0;
    for (const id of ids.map(Number)) {
      if ((usage.get(id) ?? []).length > 0) continue; // 仍被引用，跳过
      const row = db.prepare("SELECT stored_name FROM media WHERE id = ?").get(id) as
        | { stored_name: string }
        | undefined;
      if (!row) continue;
      del.run(id);
      await fs.promises.rm(path.join(MEDIA_DIR, row.stored_name), { force: true });
      deleted += 1;
    }
    return { deleted };
  });
}

interface MediaRow {
  id: number;
  filename: string;
  stored_name: string;
  mime: string;
  size: number;
  created_at: string;
}

function mimeExt(mime: string): string {
  const map: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/avif": ".avif",
  };
  return map[mime] ?? "";
}
