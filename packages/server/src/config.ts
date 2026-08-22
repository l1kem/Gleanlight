import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";

/** 仓库根目录（packages/server/src/config.ts → 上溯四级） */
export const ROOT = path.resolve(fileURLToPath(import.meta.url), "../../../..");
export const PKG_SERVER = path.join(ROOT, "packages", "server");
export const PKG_SITE = path.join(ROOT, "packages", "site");
export const PKG_ADMIN = path.join(ROOT, "packages", "admin");

export const DATA_DIR = process.env.BLOG_DATA_DIR ?? path.join(PKG_SERVER, "data");
export const MEDIA_DIR = path.join(DATA_DIR, "media");
export const DB_PATH = path.join(DATA_DIR, "blog.db");

/** 本地适配器输出目录（静态托管根，可交给 Nginx/CDN） */
export const PUBLIC_DIST = process.env.BLOG_PUBLIC_DIST ?? path.join(ROOT, "public-dist");
/** admin 构建产物（生产模式下由 server 托管） */
export const ADMIN_DIST = path.join(PKG_ADMIN, "dist");

// 默认绑定回环地址；Docker / 局域网部署改 BLOG_HOST=0.0.0.0，并用防火墙控制访问。
export const HOST = process.env.BLOG_HOST ?? "127.0.0.1";
export const PORT = Number(process.env.BLOG_PORT ?? 7300);

function ensureJwtSecret(): string {
  if (process.env.BLOG_JWT_SECRET) return process.env.BLOG_JWT_SECRET;
  const file = path.join(DATA_DIR, ".jwt-secret");
  if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();
  const secret = crypto.randomBytes(48).toString("hex");
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

export function initDirs(): void {
  for (const dir of [DATA_DIR, MEDIA_DIR]) fs.mkdirSync(dir, { recursive: true });
}

export const JWT_SECRET = () => ensureJwtSecret();
export const COOKIE_NAME = "blog_session";
export const SESSION_TTL_SEC = 60 * 60 * 24 * 7; // 7 天
