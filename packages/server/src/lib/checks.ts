import { db } from "../db.js";

/**
 * 内容健康检查：断链 / 孤立文章 / 空主题 / 元信息缺失。
 * 供 GET /health 与发布前预检共用。
 */
export interface BrokenLink {
  sourceId: number;
  sourceTitle: string;
  sourceSlug: string;
  targetSlug: string;
}
export interface OrphanPost {
  id: number;
  title: string;
  slug: string;
  updatedAt: string;
}
export interface EmptyTopic {
  id: number;
  name: string;
  domainName: string | null;
}
export interface HealthReport {
  brokenLinks: BrokenLink[];
  orphanPosts: OrphanPost[];
  emptyTopics: EmptyTopic[];
  missingSummary: { id: number; title: string }[];
  draftCount: number;
  scheduledCount: number;
}

export function runHealthChecks(): HealthReport {
  const brokenLinks = db
    .prepare(
      `SELECT l.source_id AS sourceId, p.title AS sourceTitle, p.slug AS sourceSlug, l.target_slug AS targetSlug
       FROM post_links l JOIN posts p ON p.id = l.source_id
       WHERE l.target_slug NOT IN (SELECT slug FROM posts)
       ORDER BY l.source_id`
    )
    .all() as BrokenLink[];

  const orphanPosts = db
    .prepare(
      `SELECT p.id, p.title, p.slug, p.updated_at AS updatedAt
       FROM posts p
       WHERE p.topic_id IS NULL
         AND p.slug NOT IN (SELECT target_slug FROM post_links)
       ORDER BY p.updated_at DESC`
    )
    .all() as OrphanPost[];

  const emptyTopics = db
    .prepare(
      `SELECT t.id, t.name, d.name AS domainName
       FROM topics t
       LEFT JOIN domains d ON d.id = t.domain_id
       WHERE NOT EXISTS (SELECT 1 FROM posts p WHERE p.topic_id = t.id)
       ORDER BY t.sort, t.id`
    )
    .all() as EmptyTopic[];

  const missingSummary = (
    db
      .prepare(
        `SELECT id, title FROM posts WHERE status = 'published' AND TRIM(summary) = '' ORDER BY updated_at DESC`
      )
      .all() as { id: number; title: string }[]
  ).slice(0, 20);

  const draftCount = (
    db.prepare(`SELECT COUNT(*) AS c FROM posts WHERE status = 'draft'`).get() as { c: number }
  ).c;
  const scheduledCount = (
    db
      .prepare(`SELECT COUNT(*) AS c FROM posts WHERE scheduled_at IS NOT NULL`)
      .get() as { c: number }
  ).c;

  return { brokenLinks, orphanPosts, emptyTopics, missingSummary, draftCount, scheduledCount };
}

/** 预检文本行（发布日志用；只警告不阻塞） */
export function formatPrecheck(r: HealthReport): string[] {
  const lines: string[] = [];
  const push = (ok: boolean, msg: string) => lines.push(`      ${ok ? "✓" : "⚠"} ${msg}`);
  push(r.brokenLinks.length === 0, r.brokenLinks.length === 0
    ? "双向链接无断链"
    : `断链 ${r.brokenLinks.length} 处（[[引用]] 了不存在的 slug，前台将显示为「未撰写」）`);
  push(r.missingSummary.length === 0, r.missingSummary.length === 0
    ? "已发布文章均有摘要"
    : `${r.missingSummary.length} 篇已发布文章缺摘要（影响列表/搜索展示）`);
  push(r.emptyTopics.length === 0, r.emptyTopics.length === 0
    ? "无空主题"
    : `空主题 ${r.emptyTopics.length} 个（无任何文章归属）`);
  push(true, `草稿 ${r.draftCount} 篇不导出` + (r.scheduledCount > 0 ? `；定时待发 ${r.scheduledCount} 篇` : ""));
  return lines;
}
