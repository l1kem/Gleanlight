import fs from "node:fs";
import path from "node:path";
import { db, getSetting } from "../db.js";
import { MEDIA_DIR, PKG_SITE } from "../config.js";
import type { SiteSettings, IntegrationsSettings } from "../routes/settings.js";
import { INTEGRATIONS_DEFAULT } from "../routes/settings.js";
import { filterPublicStructure, selectPublicMedia } from "../lib/publication.js";

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

export function exportContent(): {
  postCount: number;
  mediaCount: number;
  skippedUnsafeMedia: number;
} {
  const dataDir = path.join(PKG_SITE, "content", "data");
  fs.mkdirSync(dataDir, { recursive: true });

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
  const allTopics = (
    db.prepare("SELECT * FROM topics ORDER BY sort, id").all() as {
      id: number;
      domain_id: number;
      [key: string]: unknown;
    }[]
  );
  const allDomains = (
    db.prepare("SELECT * FROM domains ORDER BY sort, id").all() as {
      id: number;
      [key: string]: unknown;
    }[]
  );
  const { topics, domains } = filterPublicStructure(exported, allTopics, allDomains);
  const site = getSetting<Partial<SiteSettings>>("site", {});

  // ── 全部标签（供标签页枚举）──────────────────────────────────
  const tagCount = new Map<string, number>();
  for (const p of exported) for (const t of p.tags) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
  const tags = [...tagCount.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh"));

  writeJson(dataDir, "posts.json", exported);
  writeJson(dataDir, "structure.json", { domains, topics });
  writeJson(dataDir, "site.json", {
    ...site,
    integrations: getSetting("integrations", INTEGRATIONS_DEFAULT),
  });
  writeJson(dataDir, "tags.json", tags);

  // ── 附件同步：只发布公开文章实际引用的媒体。每次从干净暂存目录替换，
  //    避免已删除/转私密附件继续残留在后续静态产物中。──────────────
  const media = db
    .prepare("SELECT stored_name, mime FROM media ORDER BY id")
    .all() as { stored_name: string; mime: string }[];
  const { publishable, unsafe } = selectPublicMedia(exported, media);

  const publicDir = path.join(PKG_SITE, "public");
  fs.mkdirSync(publicDir, { recursive: true });
  const uploadsStage = fs.mkdtempSync(path.join(publicDir, ".uploads-next-"));
  const mediaStage = fs.mkdtempSync(path.join(publicDir, ".media-next-"));
  let copiedMedia = 0;
  try {
    for (const item of publishable) {
      const source = path.join(MEDIA_DIR, item.stored_name);
      if (!fs.existsSync(source)) continue;
      fs.copyFileSync(source, path.join(uploadsStage, item.stored_name));
      fs.copyFileSync(source, path.join(mediaStage, item.stored_name));
      // 图片缩略图（thumbs/<stored>.webp）随附件一起进静态站
      const thumb = path.join(MEDIA_DIR, "thumbs", `${item.stored_name}.webp`);
      if (fs.existsSync(thumb)) {
        fs.mkdirSync(path.join(uploadsStage, "thumbs"), { recursive: true });
        fs.mkdirSync(path.join(mediaStage, "thumbs"), { recursive: true });
        fs.copyFileSync(thumb, path.join(uploadsStage, "thumbs", `${item.stored_name}.webp`));
        fs.copyFileSync(thumb, path.join(mediaStage, "thumbs", `${item.stored_name}.webp`));
      }
      copiedMedia += 1;
    }
    replaceGeneratedDir(uploadsStage, path.join(publicDir, "uploads"));
    replaceGeneratedDir(mediaStage, path.join(publicDir, "media"));
  } catch (error) {
    fs.rmSync(uploadsStage, { recursive: true, force: true });
    fs.rmSync(mediaStage, { recursive: true, force: true });
    throw error;
  }

  return {
    postCount: exported.length,
    mediaCount: copiedMedia,
    skippedUnsafeMedia: unsafe.length,
  };
}

function writeJson(dir: string, name: string, data: unknown): void {
  fs.writeFileSync(path.join(dir, name), JSON.stringify(data, null, 1));
}

function replaceGeneratedDir(stage: string, target: string): void {
  fs.rmSync(target, { recursive: true, force: true });
  fs.renameSync(stage, target);
}
