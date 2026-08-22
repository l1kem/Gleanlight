import type { FastifyInstance } from "fastify";
import { db } from "../db.js";
import { requireAuth } from "../auth.js";
import { runHealthChecks } from "../lib/checks.js";

function slugify(input: string): string {
  return (
    input
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^\p{L}\p{N}-]/gu, "")
      .slice(0, 80) || `item-${Date.now()}`
  );
}

export async function kbRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  // 知识树：域 → 主题 → 文章计数（含草稿计数，便于后台识别未完成主题）
  app.get("/kb/tree", async () => {
    const domains = db
      .prepare("SELECT * FROM domains ORDER BY sort, id")
      .all() as { id: number; slug: string; name: string; description: string; sort: number }[];
    const topics = db
      .prepare(
        `SELECT t.*, 
           SUM(CASE WHEN p.status='published' THEN 1 ELSE 0 END) AS published_count,
           SUM(CASE WHEN p.status='draft' THEN 1 ELSE 0 END) AS draft_count
         FROM topics t LEFT JOIN posts p ON p.topic_id = t.id
         GROUP BY t.id ORDER BY t.sort, t.id`
      )
      .all();
    return { domains, topics };
  });

  app.post("/domains", async (request, reply) => {
    const b = (request.body ?? {}) as { name?: string; slug?: string; description?: string; sort?: number };
    if (!b.name?.trim()) return reply.code(400).send({ error: "请填写知识域名称" });
    const info = db
      .prepare("INSERT INTO domains(slug, name, description, sort) VALUES(?,?,?,?)")
      .run(slugify(b.slug || b.name), b.name.trim(), b.description ?? "", b.sort ?? 0);
    return reply.code(201).send({ id: Number(info.lastInsertRowid) });
  });

  app.put("/domains/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const b = (request.body ?? {}) as { name?: string; slug?: string; description?: string; sort?: number };
    const existing = db.prepare("SELECT * FROM domains WHERE id = ?").get(Number(id)) as
      | { slug: string; name: string; description: string; sort: number }
      | undefined;
    if (!existing) return reply.code(404).send({ error: "知识域不存在" });
    db.prepare("UPDATE domains SET name=?, slug=?, description=?, sort=? WHERE id=?").run(
      b.name?.trim() ?? existing.name,
      b.slug ? slugify(b.slug) : existing.slug,
      b.description ?? existing.description,
      b.sort ?? existing.sort,
      Number(id)
    );
    return { ok: true };
  });

  app.delete("/domains/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const info = db.prepare("DELETE FROM domains WHERE id = ?").run(Number(id));
    if (info.changes === 0) return reply.code(404).send({ error: "知识域不存在" });
    return { ok: true };
  });

  app.post("/topics", async (request, reply) => {
    const b = (request.body ?? {}) as {
      domain_id?: number;
      name?: string;
      slug?: string;
      description?: string;
      sort?: number;
    };
    if (!b.domain_id || !b.name?.trim())
      return reply.code(400).send({ error: "需要 domain_id 和主题名称" });
    const info = db
      .prepare("INSERT INTO topics(domain_id, slug, name, description, sort) VALUES(?,?,?,?,?)")
      .run(Number(b.domain_id), slugify(b.slug || b.name), b.name.trim(), b.description ?? "", b.sort ?? 0);
    return reply.code(201).send({ id: Number(info.lastInsertRowid) });
  });

  app.put("/topics/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const b = (request.body ?? {}) as {
      domain_id?: number;
      name?: string;
      slug?: string;
      description?: string;
      sort?: number;
    };
    const existing = db.prepare("SELECT * FROM topics WHERE id = ?").get(Number(id)) as
      | { domain_id: number; slug: string; name: string; description: string; sort: number }
      | undefined;
    if (!existing) return reply.code(404).send({ error: "主题不存在" });
    db.prepare(
      "UPDATE topics SET domain_id=?, name=?, slug=?, description=?, sort=? WHERE id=?"
    ).run(
      b.domain_id ?? existing.domain_id,
      b.name?.trim() ?? existing.name,
      b.slug ? slugify(b.slug) : existing.slug,
      b.description ?? existing.description,
      b.sort ?? existing.sort,
      Number(id)
    );
    return { ok: true };
  });

  app.delete("/topics/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const info = db.prepare("DELETE FROM topics WHERE id = ?").run(Number(id));
    if (info.changes === 0) return reply.code(404).send({ error: "主题不存在" });
    return { ok: true };
  });

  // ── 拖拽排序：按传入顺序整体重写 sort ──────────────────────
  app.put("/kb/domains/order", async (request) => {
    const { ids } = (request.body ?? {}) as { ids?: number[] };
    if (!Array.isArray(ids)) throw { statusCode: 400, message: "需要 ids 数组" };
    const stmt = db.prepare("UPDATE domains SET sort = ? WHERE id = ?");
    db.transaction(() => ids.forEach((id, i) => stmt.run(i, Number(id))))();
    return { ok: true };
  });

  app.put("/kb/topics/order", async (request) => {
    const { ids } = (request.body ?? {}) as { ids?: number[] };
    if (!Array.isArray(ids)) throw { statusCode: 400, message: "需要 ids 数组" };
    const stmt = db.prepare("UPDATE topics SET sort = ? WHERE id = ?");
    db.transaction(() => ids.forEach((id, i) => stmt.run(i, Number(id))))();
    return { ok: true };
  });

  // 主题内文章排序（也可跨主题：带 topic_id 则同时改归属）
  app.put("/kb/posts/order", async (request) => {
    const { topicId, items } = (request.body ?? {}) as {
      topicId?: number;
      items?: { id: number; topic_id?: number | null; sort: number }[];
    };
    if (!Array.isArray(items)) throw { statusCode: 400, message: "需要 items 数组" };
    const stmt = db.prepare(
      "UPDATE posts SET sort_in_topic = ?, topic_id = ? WHERE id = ?"
    );
    db.transaction(() =>
      items.forEach((it) =>
        stmt.run(Number(it.sort), it.topic_id !== undefined ? it.topic_id : (topicId ?? null), Number(it.id))
      )
    )();
    return { ok: true };
  });

  // 知识库全部文章（后台拖拽用）
  app.get("/kb/posts", async () => {
    return {
      items: db
        .prepare(
          `SELECT p.id, p.title, p.slug, p.status, p.topic_id, p.sort_in_topic, p.updated_at
           FROM posts p ORDER BY p.topic_id, p.sort_in_topic, p.id`
        )
        .all(),
    };
  });

  // 知识图谱：节点 = 已发布文章，边 = [[双链]]
  app.get("/kb/graph", async () => {
    const nodes = db
      .prepare(
        `SELECT p.id, p.slug, p.title, p.status, p.topic_id, t.name AS topic_name
         FROM posts p LEFT JOIN topics t ON t.id = p.topic_id`
      )
      .all() as {
      id: number;
      slug: string;
      title: string;
      status: string;
      topic_id: number | null;
      topic_name: string | null;
    }[];
    const slugToId = new Map(nodes.map((n) => [n.slug, n.id]));
    const rawEdges = db
      .prepare("SELECT source_id, target_slug FROM post_links")
      .all() as { source_id: number; target_slug: string }[];
    const seen = new Set<string>();
    const edges: { source: number; target: number }[] = [];
    for (const e of rawEdges) {
      const target = slugToId.get(e.target_slug);
      if (target == null) continue; // 断链不进图谱（健康检查里报）
      const key = `${Math.min(e.source_id, target)}:${Math.max(e.source_id, target)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ source: e.source_id, target });
    }
    return { nodes, edges };
  });

  // 内容健康检查（断链/孤立/空主题）
  app.get("/health", async () => {
    return runHealthChecks();
  });
}
