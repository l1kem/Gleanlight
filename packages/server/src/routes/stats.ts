import type { FastifyInstance } from "fastify";
import { db } from "../db.js";
import { requireAuth } from "../auth.js";

/** 写作统计：本月字数 / 连续写作天数 / 最近构建 */
export async function statsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/stats", async () => {
    const month = (
      db.prepare("SELECT substr(datetime('now'), 1, 7) AS m").get() as { m: string }
    ).m;

    const wordsThisMonth = (
      db
        .prepare(
          `SELECT COALESCE(SUM(LENGTH(content_md)), 0) AS c FROM posts
           WHERE substr(updated_at, 1, 7) = ?`
        )
        .get(month) as { c: number }
    ).c;
    const totalWords = (
      db.prepare("SELECT COALESCE(SUM(LENGTH(content_md)), 0) AS c FROM posts").get() as {
        c: number;
      }
    ).c;
    const postsThisMonth = (
      db
        .prepare(`SELECT COUNT(*) AS c FROM posts WHERE substr(created_at, 1, 7) = ?`)
        .get(month) as { c: number }
    ).c;

    // 写作日 = 有文章更新或有版本快照的日子（sqlite UTC → 本地日）
    const days = new Set<string>();
    const toLocalDay = (sqliteTs: string): string => {
      const ms = Date.parse(`${sqliteTs.replace(" ", "T")}Z`);
      return Number.isNaN(ms) ? "" : new Date(ms).toLocaleDateString("sv-SE");
    };
    for (const r of db.prepare("SELECT DISTINCT substr(updated_at, 1, 10) AS d FROM posts").all() as { d: string }[]) {
      if (r.d) days.add(toLocalDay(`${r.d} 12:00:00`));
    }
    for (const r of db
      .prepare("SELECT DISTINCT substr(created_at, 1, 10) AS d FROM post_revisions")
      .all() as { d: string }[]) {
      if (r.d) days.add(toLocalDay(`${r.d} 12:00:00`));
    }

    // 连续写作天数：从今天（或昨天）往前数
    let streak = 0;
    const cursor = new Date();
    if (!days.has(cursor.toLocaleDateString("sv-SE"))) cursor.setDate(cursor.getDate() - 1); // 今天还没写，从昨天起算
    while (days.has(cursor.toLocaleDateString("sv-SE"))) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }

    const recentBuilds = db
      .prepare(
        "SELECT id, status, adapter, created_at, finished_at FROM builds ORDER BY id DESC LIMIT 5"
      )
      .all();
    const lastSuccess = db
      .prepare("SELECT finished_at FROM builds WHERE status = 'success' ORDER BY id DESC LIMIT 1")
      .get() as { finished_at: string } | undefined;

    return {
      wordsThisMonth,
      totalWords,
      postsThisMonth,
      writingDays: days.size,
      streak,
      recentBuilds,
      lastPublishAt: lastSuccess?.finished_at ?? null,
    };
  });

  // 仪表盘概览：一次请求拿全计数（替代前端拉列表自己数）
  app.get("/stats/overview", async () => {
    const one = (sql: string) => (db.prepare(sql).get() as { c: number }).c;
    return {
      published: one("SELECT COUNT(*) AS c FROM posts WHERE status = 'published'"),
      drafts: one("SELECT COUNT(*) AS c FROM posts WHERE status = 'draft'"),
      scheduled: one(
        "SELECT COUNT(*) AS c FROM posts WHERE scheduled_at IS NOT NULL AND scheduled_at > datetime('now')"
      ),
      topics: one("SELECT COUNT(*) AS c FROM topics"),
      domains: one("SELECT COUNT(*) AS c FROM domains"),
      media: one("SELECT COUNT(*) AS c FROM media"),
      mediaBytes: one("SELECT COALESCE(SUM(size), 0) AS c FROM media"),
      privatePosts: one("SELECT COUNT(*) AS c FROM posts WHERE private = 1"),
    };
  });
}
