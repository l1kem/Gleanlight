import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { db } from "../db.js";
import { requireAuth } from "../auth.js";
import { MEDIA_DIR } from "../config.js";
import { extractWikilinks, readingTime } from "@gleanlight/markdown";

/**
 * 本地知识库（Obsidian 目录）导入：只读源目录，拷贝副本入库。
 * 映射：顶级目录 → 知识域（去 "NN-" 编号前缀）；二级目录 → 主题；
 *      根/三级以下 md → 按所属二级主题归组；引用到的附件 → 媒体库。
 * 安全默认：全部导入为「草稿 + 私密」，不会进入发布产物，直到你手动发布。
 */

const SKIP_DIRS = new Set([".obsidian", ".trash", ".stfolder", "node_modules", ".git"]);
const ATTACH_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif", ".bmp",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".mp3", ".mp4", ".zip",
]);
const MAX_IMPORT_FILES = 2000;

function slugify(input: string): string {
  return (
    input
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^\p{L}\p{N}-]/gu, "")
      .slice(0, 80) || `note-${Date.now()}`)
}

function stripNumPrefix(name: string): string {
  return name.replace(/^\d{1,2}[-_.、]\s*/, "");
}

function listMdFiles(root: string, dir: string, out: { abs: string; rel: string }[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && !SKIP_DIRS.has(entry.name)) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      listMdFiles(root, abs, out);
    } else if (entry.name.toLowerCase().endsWith(".md")) {
      out.push({ abs, rel: path.relative(root, abs) });
    }
  }
}

/** 极简 frontmatter：--- 之间的 key: value */
function parseFrontmatter(src: string): { fm: Record<string, string>; body: string } {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { fm: {}, body: src };
  const fm: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([\w-]+)\s*:\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].replace(/^["']|["']$/g, "").trim();
  }
  return { fm, body: src.slice(m[0].length) };
}

function titleOf(fm: Record<string, string>, body: string, filename: string): string {
  if (fm.title) return fm.title;
  const h1 = body.match(/^#\s+(.+)$/m);
  if (h1) return h1[1].trim();
  return filename.replace(/\.md$/i, "");
}

function expandHome(p: string): string {
  return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
}

export async function wikiRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  // ── 扫描预览（不动任何文件）──────────────────────────────────
  app.post("/wiki/scan", async (request, reply) => {
    const { path: rawRoot } = (request.body ?? {}) as { path?: string };
    if (!rawRoot) return reply.code(400).send({ error: "需要目录路径" });
    const root = path.resolve(expandHome(rawRoot));
    if (!path.isAbsolute(root)) return reply.code(400).send({ error: "需要绝对路径" });
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      return reply.code(404).send({ error: `目录不存在：${root}` });
    }
    const files: { abs: string; rel: string }[] = [];
    listMdFiles(root, root, files);
    if (files.length > MAX_IMPORT_FILES) {
      return reply.code(413).send({ error: `md 文件过多（${files.length} > ${MAX_IMPORT_FILES}）` });
    }

    const tree = new Map<string, Map<string, number>>();
    let attachRefs = 0;
    let loose = 0;
    for (const f of files) {
      const seg = f.rel.split(path.sep);
      const domainName = seg.length === 1 ? "未分类" : stripNumPrefix(seg[0]);
      const topicName =
        seg.length <= 2 ? (seg.length === 1 ? "根目录" : "综合") : stripNumPrefix(seg[1]);
      if (!tree.has(domainName)) tree.set(domainName, new Map());
      const t = tree.get(domainName)!;
      t.set(topicName, (t.get(topicName) ?? 0) + 1);
      if (seg.length === 1) loose += 1;
      // 统计被引用的附件数（去重）
      try {
        const src = fs.readFileSync(f.abs, "utf8");
        for (const m of src.matchAll(/!\[[^\]]*\]\(([^)]+)\)|!\[\[([^\]]+)\]\]/g)) {
          const ref = (m[1] ?? m[2] ?? "").split("#")[0].trim();
          if (ref && !/^https?:/.test(ref)) attachRefs += 1;
        }
      } catch {
        /* 读不了的文件跳过统计 */
      }
    }
    return {
      root,
      totalMd: files.length,
      loose,
      attachRefs,
      domains: [...tree.entries()].map(([name, topics]) => ({
        name,
        topics: [...topics.entries()].map(([tname, count]) => ({ name: tname, count })),
      })),
    };
  });

  // ── 执行导入（拷贝副本，源目录零写入）─────────────────────────
  app.post("/wiki/import", async (request, reply) => {
    const { path: rawRoot, dryRun = false } = (request.body ?? {}) as {
      path?: string;
      dryRun?: boolean;
    };
    if (!rawRoot) return reply.code(400).send({ error: "需要目录路径" });
    const root = path.resolve(expandHome(rawRoot));
    if (!path.isAbsolute(root)) return reply.code(400).send({ error: "需要绝对路径" });
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
      return reply.code(404).send({ error: `目录不存在：${root}` });
    }
    const files: { abs: string; rel: string }[] = [];
    listMdFiles(root, root, files);
    if (files.length > MAX_IMPORT_FILES) {
      return reply.code(413).send({ error: `md 文件过多（${files.length}）` });
    }
    if (dryRun) return { dryRun: true, totalMd: files.length };

    const uniq = (desired: string): string => {
      let c = desired;
      let i = 1;
      while (db.prepare("SELECT id FROM posts WHERE slug = ?").get(c)) c = `${desired}-${++i}`;
      return c;
    };
    const uniqTopic = (desired: string): string => {
      let c = desired;
      let i = 1;
      while (db.prepare("SELECT id FROM topics WHERE slug = ?").get(c)) c = `${desired}-${++i}`;
      return c;
    };
    const findDomain = db.prepare("SELECT id FROM domains WHERE name = ?");
    const insDomain = db.prepare("INSERT INTO domains(slug, name, description, sort) VALUES(?,?,?,?)");
    const findTopic = db.prepare("SELECT id FROM topics WHERE domain_id = ? AND name = ?");
    const insTopic = db.prepare("INSERT INTO topics(domain_id, slug, name, description, sort) VALUES(?,?,?,?,?)");
    const insPost = db.prepare(
      `INSERT INTO posts(slug, title, summary, content_md, status, featured, topic_id, sort_in_topic,
        tags, cover, reading_time, private, created_at, updated_at)
       VALUES(?,?,?,?,'draft',0,?,?, '[]',NULL,?,1,datetime('now'),datetime('now'))`
    );
    const insLink = db.prepare("INSERT OR IGNORE INTO post_links(source_id, target_slug) VALUES(?,?)");
    const insMedia = db.prepare("INSERT INTO media(filename, stored_name, mime, size) VALUES(?,?,?,?)");
    const hasSlug = db.prepare("SELECT id FROM posts WHERE slug = ?");

    const domainCache = new Map<string, number>();
    const topicCache = new Map<string, number>();
    const mediaCache = new Map<string, string>(); // 绝对路径 -> uploads/<stored>
    const mimeOf = (ext: string): string => {
      const map: Record<string, string> = {
        ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
        ".webp": "image/webp", ".svg": "image/svg+xml", ".avif": "image/avif", ".bmp": "image/bmp",
        ".pdf": "application/pdf",
        ".doc": "application/msword", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".xls": "application/vnd.ms-excel", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".ppt": "application/vnd.ms-powerpoint", ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ".mp3": "audio/mpeg", ".mp4": "video/mp4", ".zip": "application/zip",
      };
      return map[ext] ?? "application/octet-stream";
    };

    function ensureDomain(name: string): number {
      const hit = domainCache.get(name);
      if (hit) return hit;
      const row = findDomain.get(name) as { id: number } | undefined;
      const id =
        row?.id ??
        Number(
          insDomain.run(slugify(name), name, `由本地知识库导入`, domainCache.size).lastInsertRowid
        );
      domainCache.set(name, id);
      return id;
    }
    function ensureTopic(domainId: number, name: string): number {
      const key = `${domainId}/${name}`;
      const hit = topicCache.get(key);
      if (hit) return hit;
      const row = findTopic.get(domainId, name) as { id: number } | undefined;
      const id =
        row?.id ??
        Number(
          insTopic.run(domainId, uniqTopic(slugify(name)), name, "", topicCache.size).lastInsertRowid
        );
      topicCache.set(key, id);
      return id;
    }
    function importAttachment(absPath: string): string | null {
      if (mediaCache.has(absPath)) return mediaCache.get(absPath)!;
      let stat: fs.Stats;
      try {
        stat = fs.statSync(absPath);
      } catch {
        return null;
      }
      if (!stat.isFile() || stat.size > 20 * 1024 * 1024) return null;
      const ext = path.extname(absPath).toLowerCase();
      if (!ATTACH_EXTS.has(ext)) return null;
      const stored = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`;
      fs.copyFileSync(absPath, path.join(MEDIA_DIR, stored));
      insMedia.run(path.basename(absPath), stored, mimeOf(ext), stat.size);
      const rel = `uploads/${stored}`;
      mediaCache.set(absPath, rel);
      return rel;
    }

    let imported = 0;
    let skipped = 0;
    let attachments = 0;
    const sortCounter = new Map<number, number>();

    for (const f of files) {
      const seg = f.rel.split(path.sep);
      const fileSlug = slugify(path.basename(f.rel, ".md"));
      if (hasSlug.get(fileSlug)) {
        skipped += 1;
        continue;
      }
      let src: string;
      try {
        src = fs.readFileSync(f.abs, "utf8");
      } catch {
        skipped += 1;
        continue;
      }
      const { fm, body } = parseFrontmatter(src);
      const title = titleOf(fm, body, path.basename(f.rel));

      const domainName = seg.length === 1 ? "未分类" : stripNumPrefix(seg[0]);
      const topicName = seg.length <= 2 ? (seg.length === 1 ? "根目录" : "综合") : stripNumPrefix(seg[1]);
      const domainId = ensureDomain(domainName);
      const topicId = ensureTopic(domainId, topicName);

      // 附件引用：!\[[att]] 嵌入展开 → ![alt](rel)；找到文件则入库并改写为 uploads/
      let content = body.replace(/!\[\[([^\]]+)\]\]/g, (_m, inner: string) => {
        const [target, ...alias] = inner.split("|");
        return `![${(alias[0] ?? path.basename(target)).trim()}](${target.trim()})`;
      });
      content = content.replace(/(!\[[^\]]*\]\()([^)]+)(\))/g, (m, head: string, ref: string, tail: string) => {
        const clean = ref.split("#")[0].trim();
        if (!clean || /^https?:|^\/|^uploads\//.test(clean)) return m;
        const abs = path.resolve(path.dirname(f.abs), decodeURIComponent(clean));
        const rel = importAttachment(abs);
        if (!rel) return m;
        attachments += 1;
        return `${head}${rel}${tail}`;
      });
      // [[笔记名]] 双链去路径前缀（slug = 文件名）
      content = content.replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, (m, target: string, alias?: string) => {
        const name = target.trim().replace(/\.md$/i, "").split("/").pop()!.trim();
        return `[[${name}${alias ?? ""}]]`;
      });

      const sort = (sortCounter.get(topicId) ?? 0) + 1;
      sortCounter.set(topicId, sort);
      const info = insPost.run(
        fileSlug,
        title,
        fm.summary ?? String(fm.description ?? "").slice(0, 120),
        content,
        topicId,
        sort,
        readingTime(content),
      );
      const pid = Number(info.lastInsertRowid);
      for (const slug of extractWikilinks(content)) insLink.run(pid, slug);
      imported += 1;
    }

    return { imported, skipped, attachments, domains: domainCache.size, topics: topicCache.size };
  });
}
