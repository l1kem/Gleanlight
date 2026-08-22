import Database from "better-sqlite3";
import fs from "node:fs";
import { DB_PATH, initDirs } from "./config.js";

initDirs();

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  totp_secret   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 知识库三层：域(domain) → 主题(topic) → 文章(post)
CREATE TABLE IF NOT EXISTS domains (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS topics (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  domain_id   INTEGER NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
  slug        TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS posts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  slug           TEXT UNIQUE NOT NULL,
  title          TEXT NOT NULL,
  summary        TEXT NOT NULL DEFAULT '',
  content_md     TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published')),
  featured       INTEGER NOT NULL DEFAULT 0,
  topic_id       INTEGER REFERENCES topics(id) ON DELETE SET NULL,
  sort_in_topic  INTEGER NOT NULL DEFAULT 0,
  tags           TEXT NOT NULL DEFAULT '[]',
  cover          TEXT,
  reading_time   INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  published_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_topic ON posts(topic_id, sort_in_topic);

-- 文章间双向关联（[[slug]]），target 存 slug 便于导出后前台独立解析
CREATE TABLE IF NOT EXISTS post_links (
  source_id   INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  target_slug TEXT NOT NULL,
  PRIMARY KEY (source_id, target_slug)
);

CREATE TABLE IF NOT EXISTS media (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  filename    TEXT NOT NULL,
  stored_name TEXT UNIQUE NOT NULL,
  mime        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL -- JSON
);

CREATE TABLE IF NOT EXISTS builds (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  status      TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running','success','failed')),
  adapter     TEXT NOT NULL DEFAULT 'local',
  log         TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);

-- 版本历史：保存/自动保存时的文章快照（滚动合并，2 分钟窗口内不重复堆积）
CREATE TABLE IF NOT EXISTS post_revisions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  summary    TEXT NOT NULL DEFAULT '',
  content_md TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_revisions_post ON post_revisions(post_id, id DESC);
`);

// 轻量列迁移：定时发布 + 私密标记（老库平滑升级）
{
  const cols = db.prepare("PRAGMA table_info(posts)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "scheduled_at")) {
    db.exec("ALTER TABLE posts ADD COLUMN scheduled_at TEXT");
  }
  if (!cols.some((c) => c.name === "private")) {
    db.exec("ALTER TABLE posts ADD COLUMN private INTEGER NOT NULL DEFAULT 0");
  }
}

export function getSetting<T>(key: string, fallback: T): T {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export function setSetting(key: string, value: unknown): void {
  db.prepare(
    "INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, JSON.stringify(value));
}

export function backupDb(): string {
  const backupPath = `${DB_PATH}.backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  fs.copyFileSync(DB_PATH, backupPath);
  return backupPath;
}
