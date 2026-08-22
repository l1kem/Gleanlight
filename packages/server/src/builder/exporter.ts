import fs from "node:fs";
import path from "node:path";
import { db, getSetting } from "../db.js";
import { MEDIA_DIR, PKG_SITE } from "../config.js";
import type { SiteSettings } from "../routes/settings.js";

/**
 * 导出器：把 SQLite 中已发布内容物化为 Astro 可消费的静态数据。
 * 目录：packages/site/content/data/（.gitignore）+ packages/site/public/media/
 */

export interface ExportedPost {
  id: number;
  slug: string;
  title: string;
  summary: string;
  contentMd: string;
  featured: boolean;
  topicId: number | null;
  topicSlug: string | null;
  topicName: string | null;
  domainSlug: string | null;
  domainName: string | null;
  sortInTopic: number;
  tags: string[];
  cover: string | null;
  readingTime: number;
  publishedAt: string;
  updatedAt: string;
  links: string[]; // 本文 [[引用]] 的 slug
}

export function exportContent(): { postCount: number } {
  const dataDir = path.join(PKG_SITE, "content", "data");
  const siteUploadsDir = path.join(PKG_SITE, "public", "uploads");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(siteUploadsDir, { recursive: true });

  // ── 文章（仅已发布且非私密：私密内容永不进入发布产物）──────────
  const posts = db
    .prepare(
      `SELECT p.id, p.slug, p.title, p.summary, p.content_md, p.featured, p.topic_id,
              p.sort_in_topic, p.tags, p.cover, p.reading_time, p.published_at, p.updated_at,
              t.slug AS topic_slug, t.name AS topic_name,
              d.slug AS domain_slug, d.name AS domain_name
       FROM posts p
       LEFT JOIN topics t ON p.topic_id = t.id
       LEFT JOIN domains d ON t.domain_id = d.id
       WHERE p.status = 'published' AND p.private = 0
       ORDER BY p.published_at DESC`
    )
    .all() as Record<string, unknown>[];

  const linksStmt = db.prepare("SELECT target_slug FROM post_links WHERE source_id = ?");
  const exported: ExportedPost[] = posts.map((p) => ({
    id: p.id as number,
    slug: p.slug as string,
    title: p.title as string,
    summary: p.summary as string,
    contentMd: p.content_md as string,
    featured: Boolean(p.featured),
    topicId: (p.topic_id as number | null) ?? null,
    topicSlug: (p.topic_slug as string | null) ?? null,
    topicName: (p.topic_name as string | null) ?? null,
    domainSlug: (p.domain_slug as string | null) ?? null,
    domainName: (p.domain_name as string | null) ?? null,
    sortInTopic: p.sort_in_topic as number,
    tags: JSON.parse((p.tags as string) || "[]"),
    cover: (p.cover as string | null) ?? null,
    readingTime: p.reading_time as number,
    publishedAt: (p.published_at as string) ?? "",
    updatedAt: p.updated_at as string,
    links: (linksStmt.all(p.id as number) as { target_slug: string }[]).map((l) => l.target_slug),
  }));

  // ── 知识结构 ─────────────────────────────────────────────────
  const domains = db.prepare("SELECT * FROM domains ORDER BY sort, id").all();
  const topics = db.prepare("SELECT * FROM topics ORDER BY sort, id").all();
  const site = getSetting<Partial<SiteSettings>>("site", {});

  // ── 全部标签（供标签页枚举）──────────────────────────────────
  const tagCount = new Map<string, number>();
  for (const p of exported) for (const t of p.tags) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
  const tags = [...tagCount.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh"));

  writeJson(dataDir, "posts.json", exported);
  writeJson(dataDir, "structure.json", { domains, topics });
  writeJson(dataDir, "site.json", site);
  writeJson(dataDir, "tags.json", tags);

  // ── 附件同步：md 里统一是相对路径 uploads/<file>；
  //    导出两份（uploads/ 新约定 + media/ 兼容旧引用），量大后可改增量 ──
  fs.cpSync(MEDIA_DIR, siteUploadsDir, { recursive: true });
  fs.cpSync(MEDIA_DIR, path.join(PKG_SITE, "public", "media"), { recursive: true });

  return { postCount: exported.length };
}

function writeJson(dir: string, name: string, data: unknown): void {
  fs.writeFileSync(path.join(dir, name), JSON.stringify(data, null, 1));
}
