import type { FastifyInstance } from "fastify";
import { db } from "../db.js";
import { requireAuth } from "../auth.js";
import { extractWikilinks, readingTime } from "@gleanlight/markdown";
import { normalizeScheduledAt } from "../lib/time.js";

export interface PostRow {
  id: number;
  slug: string;
  title: string;
  summary: string;
  content_md: string;
  status: "draft" | "published";
  featured: number;
  topic_id: number | null;
  sort_in_topic: number;
  tags: string;
  cover: string | null;
  reading_time: number;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  scheduled_at: string | null;
  private: number;
}

function parseTags(tags: unknown): string[] {
  if (Array.isArray(tags)) return tags.map(String).map((t) => t.trim()).filter(Boolean);
  if (typeof tags === "string") {
    return tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean);
  }
  return [];
}

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}-]/gu, "")
    .slice(0, 80) || `post-${Date.now()}`;
}

function uniqueSlug(desired: string, excludeId?: number): string {
  let candidate = desired;
  let i = 1;
  while (true) {
    const row = db.prepare("SELECT id FROM posts WHERE slug = ?").get(candidate) as { id: number } | undefined;
    if (!row || row.id === excludeId) return candidate;
    candidate = `${desired}-${++i}`;
  }
}

/** 正文变化时同步派生数据：阅读时长 + 双向关联 */
function syncDerived(postId: number, contentMd: string): void {
  db.prepare("UPDATE posts SET reading_time = ? WHERE id = ?").run(readingTime(contentMd), postId);
  db.prepare("DELETE FROM post_links WHERE source_id = ?").run(postId);
  const ins = db.prepare("INSERT OR IGNORE INTO post_links(source_id, target_slug) VALUES(?, ?)");
  for (const slug of extractWikilinks(contentMd)) ins.run(postId, slug);
}

/** 保存前快照旧版本：2 分钟窗口内滚动合并到同一快照，避免自动保存刷屏 */
function snapshotRevision(existing: { id: number; title: string; summary: string; content_md: string }): void {
  const last = db
    .prepare("SELECT id, created_at FROM post_revisions WHERE post_id = ? ORDER BY id DESC LIMIT 1")
    .get(existing.id) as { id: number; created_at: string } | undefined;
  // sqlite datetime('now') 是 UTC，无时区后缀 → 补 Z 解析
  const lastMs = last ? Date.parse(`${last.created_at.replace(" ", "T")}Z`) : 0;
  if (last && Date.now() - lastMs < 120_000) {
    db.prepare(
      `UPDATE post_revisions SET title=?, summary=?, content_md=?, created_at=datetime('now') WHERE id=?`
    ).run(existing.title, existing.summary, existing.content_md, last.id);
  } else {
    db.prepare(
      "INSERT INTO post_revisions(post_id, title, summary, content_md) VALUES(?,?,?,?)"
    ).run(existing.id, existing.title, existing.summary, existing.content_md);
  }
}

export async function postRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  // 列表（管理端，含草稿；?status=&q=&topic_id=&page=&pageSize=）
  app.get("/posts", async (request) => {
    const q = request.query as {
      status?: string;
      q?: string;
      topic_id?: string;
      page?: string;
      pageSize?: string;
    };
    const page = Math.max(1, Number(q.page ?? 1));
    const pageSize = Math.min(50, Math.max(1, Number(q.pageSize ?? 20)));
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.status === "draft" || q.status === "published") {
      where.push("status = ?");
      params.push(q.status);
    }
    if (q.topic_id) {
      where.push("topic_id = ?");
      params.push(Number(q.topic_id));
    }
    if (q.q) {
      where.push("(title LIKE ? OR summary LIKE ?)");
      params.push(`%${q.q}%`, `%${q.q}%`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const total = (db.prepare(`SELECT COUNT(*) AS c FROM posts ${whereSql}`).get(...params) as { c: number }).c;
    const items = db
      .prepare(
        `SELECT p.*, t.name AS topic_name, d.name AS domain_name
         FROM posts p LEFT JOIN topics t ON p.topic_id = t.id
         LEFT JOIN domains d ON t.domain_id = d.id
         ${whereSql} ORDER BY p.updated_at DESC LIMIT ? OFFSET ?`
      )
      .all(...params, pageSize, (page - 1) * pageSize);
    return { items, total, page, pageSize };
  });

  app.get("/posts/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const post = db
      .prepare(
        `SELECT p.*, t.name AS topic_name, t.slug AS topic_slug, d.name AS domain_name, d.slug AS domain_slug
         FROM posts p LEFT JOIN topics t ON p.topic_id = t.id
         LEFT JOIN domains d ON t.domain_id = d.id WHERE p.id = ?`
      )
      .get(Number(id));
    if (!post) return reply.code(404).send({ error: "文章不存在" });
    const links = db
      .prepare("SELECT target_slug FROM post_links WHERE source_id = ?")
      .all(Number(id)) as { target_slug: string }[];
    const backlinks = db
      .prepare(
        `SELECT p.id, p.slug, p.title FROM post_links l JOIN posts p ON p.id = l.source_id
         WHERE l.target_slug = (SELECT slug FROM posts WHERE id = ?) AND p.status = 'published'`
      )
      .all(Number(id));
    return { ...post, links: links.map((l) => l.target_slug), backlinks };
  });

  app.post("/posts", async (request, reply) => {
    const b = (request.body ?? {}) as Partial<PostRow> & { tags?: unknown };
    const title = (b.title ?? "").trim() || "未命名草稿";
    const slug = uniqueSlug(b.slug ? slugify(String(b.slug)) : slugify(title));
    const contentMd = b.content_md ?? "";
    const scheduledAt = normalizeScheduledAt(b.scheduled_at);
    if (scheduledAt === undefined) {
      return reply.code(400).send({ error: "定时发布时间格式无效" });
    }
    const info = db
      .prepare(
        `INSERT INTO posts(slug, title, summary, content_md, status, featured, topic_id, sort_in_topic, tags, cover, scheduled_at)
         VALUES(?,?,?,?,'draft',?,?,?,?,?,?)`
      )
      .run(
        slug,
        title,
        b.summary ?? "",
        contentMd,
        b.featured ? 1 : 0,
        b.topic_id ?? null,
        b.sort_in_topic ?? 0,
        JSON.stringify(parseTags(b.tags)),
        b.cover ?? null,
        scheduledAt
      );
    syncDerived(Number(info.lastInsertRowid), contentMd);
    return reply.code(201).send({ id: Number(info.lastInsertRowid), slug });
  });

  app.put("/posts/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const pid = Number(id);
    const existing = db.prepare("SELECT * FROM posts WHERE id = ?").get(pid) as PostRow | undefined;
    if (!existing) return reply.code(404).send({ error: "文章不存在" });
    const b = (request.body ?? {}) as Partial<PostRow> & { tags?: unknown };

    const title = b.title !== undefined ? String(b.title).trim() : existing.title;
    const contentMd = b.content_md !== undefined ? String(b.content_md) : existing.content_md;
    const summary = b.summary !== undefined ? String(b.summary) : existing.summary;
    const slug =
      b.slug !== undefined && slugify(String(b.slug)) !== existing.slug
        ? uniqueSlug(slugify(String(b.slug)), pid)
        : existing.slug;
    const status =
      b.status === "published" || b.status === "draft" ? b.status : existing.status;
    const normalizedScheduledAt =
      b.scheduled_at !== undefined ? normalizeScheduledAt(b.scheduled_at) : existing.scheduled_at;
    if (normalizedScheduledAt === undefined) {
      return reply.code(400).send({ error: "定时发布时间格式无效" });
    }

    // 内容实质变化才快照（纯改元数据不产生版本噪音）
    if (contentMd !== existing.content_md || title !== existing.title || summary !== existing.summary) {
      snapshotRevision(existing);
    }

    db.prepare(
      `UPDATE posts SET slug=?, title=?, summary=?, content_md=?, status=?, featured=?,
       topic_id=?, sort_in_topic=?, tags=?, cover=?, updated_at=datetime('now'), scheduled_at=?, private=?,
       published_at=CASE WHEN ?='published' AND published_at IS NULL THEN datetime('now') ELSE published_at END
       WHERE id=?`
    ).run(
      slug,
      title,
      summary,
      contentMd,
      status,
      b.featured !== undefined ? (b.featured ? 1 : 0) : existing.featured,
      b.topic_id !== undefined ? (b.topic_id ? Number(b.topic_id) : null) : existing.topic_id,
      b.sort_in_topic !== undefined ? Number(b.sort_in_topic) : existing.sort_in_topic,
      b.tags !== undefined ? JSON.stringify(parseTags(b.tags)) : existing.tags,
      b.cover !== undefined ? b.cover : existing.cover,
      normalizedScheduledAt,
      b.private !== undefined ? (b.private ? 1 : 0) : existing.private,
      status,
      pid
    );
    if (contentMd !== existing.content_md) syncDerived(pid, contentMd);
    return { ok: true, slug };
  });

  app.delete("/posts/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const info = db.prepare("DELETE FROM posts WHERE id = ?").run(Number(id));
    if (info.changes === 0) return reply.code(404).send({ error: "文章不存在" });
    return { ok: true };
  });

  // ── 版本历史 ────────────────────────────────────────────────
  app.get("/posts/:id/revisions", async (request, reply) => {
    const { id } = request.params as { id: string };
    const items = db
      .prepare(
        `SELECT id, title, summary, length(content_md) AS chars, created_at
         FROM post_revisions WHERE post_id = ? ORDER BY id DESC LIMIT 50`
      )
      .all(Number(id));
    if (!items) return reply.code(404).send({ error: "文章不存在" });
    return { items };
  });

  app.get("/posts/:id/revisions/:rid", async (request, reply) => {
    const { id, rid } = request.params as { id: string; rid: string };
    const rev = db
      .prepare("SELECT id, title, summary, content_md, created_at FROM post_revisions WHERE id = ? AND post_id = ?")
      .get(Number(rid), Number(id));
    if (!rev) return reply.code(404).send({ error: "版本不存在" });
    return rev;
  });

  app.post("/posts/:id/revisions/:rid/restore", async (request, reply) => {
    const { id, rid } = request.params as { id: string; rid: string };
    const pid = Number(id);
    const rev = db
      .prepare("SELECT * FROM post_revisions WHERE id = ? AND post_id = ?")
      .get(Number(rid), pid) as
      | { id: number; title: string; summary: string; content_md: string }
      | undefined;
    if (!rev) return reply.code(404).send({ error: "版本不存在" });
    const existing = db.prepare("SELECT * FROM posts WHERE id = ?").get(pid) as PostRow | undefined;
    if (!existing) return reply.code(404).send({ error: "文章不存在" });
    snapshotRevision(existing); // 回滚前先保住当前版本
    db.prepare(
      `UPDATE posts SET title=?, summary=?, content_md=?, updated_at=datetime('now') WHERE id=?`
    ).run(rev.title, rev.summary, rev.content_md, pid);
    syncDerived(pid, rev.content_md);
    return { ok: true };
  });

  // ── ⌘K 命令面板数据（一次拉全，量小）─────────────────────────
  app.get("/palette", async () => {
    const posts = db
      .prepare(
        `SELECT p.id, p.title, p.slug, p.status, t.name AS topic_name
         FROM posts p LEFT JOIN topics t ON t.id = p.topic_id
         ORDER BY p.updated_at DESC LIMIT 500`
      )
      .all();
    const domains = db.prepare("SELECT id, name FROM domains ORDER BY sort, id").all();
    const topics = db
      .prepare(
        `SELECT t.id, t.name, t.domain_id, d.name AS domain_name
         FROM topics t LEFT JOIN domains d ON d.id = t.domain_id ORDER BY t.sort, t.id`
      )
      .all();
    return { posts, domains, topics };
  });
}
