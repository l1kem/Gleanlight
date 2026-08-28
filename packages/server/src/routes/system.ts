import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DATA_DIR, MEDIA_DIR, BACKUP_KEEP } from "../config.js";
import { backupDb } from "../db.js";
import { requireAuth } from "../auth.js";

const run = promisify(execFile);
const BACKUP_DIR = path.join(DATA_DIR, "backups");
const NAME_RE = /^[\w.-]+\.(db|tar\.gz)$/;

interface BackupItem {
  name: string;
  kind: "db" | "archive";
  size: number;
  createdAt: string;
}

function listBackups(): BackupItem[] {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((n) => NAME_RE.test(n))
    .map((name) => {
      const st = fs.statSync(path.join(BACKUP_DIR, name));
      return {
        name,
        kind: name.endsWith(".tar.gz") ? ("archive" as const) : ("db" as const),
        size: st.size,
        createdAt: st.mtime.toISOString(),
      };
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** 打一个完整归档：blog.db 快照 + media/ 附件（tar.gz），超出保留数自动清理 */
async function createArchive(): Promise<string> {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const dbSnapshot = await backupDb(); // 一致性快照（含 WAL 合并）
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const archive = path.join(BACKUP_DIR, `gleanlight-${stamp}.tar.gz`);
  const stage = path.join(DATA_DIR, `.backup-stage-${Date.now()}`);
  fs.mkdirSync(stage, { recursive: true });
  try {
    fs.copyFileSync(dbSnapshot, path.join(stage, "blog.db"));
    if (fs.existsSync(MEDIA_DIR)) {
      fs.cpSync(MEDIA_DIR, path.join(stage, "media"), { recursive: true });
    }
    await run("tar", ["-czf", archive, "-C", stage, "."]);
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
  // 归档保留策略：只留最近 BACKUP_KEEP 份
  const archives = fs
    .readdirSync(BACKUP_DIR)
    .filter((n) => n.endsWith(".tar.gz"))
    .sort()
    .reverse();
  for (const stale of archives.slice(BACKUP_KEEP)) {
    fs.rmSync(path.join(BACKUP_DIR, stale), { force: true });
  }
  return path.basename(archive);
}

export async function systemRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/system/backups", async () => ({ items: listBackups() }));

  app.post("/system/backups", async (_request, reply) => {
    try {
      const name = await createArchive();
      return reply.code(201).send({ ok: true, name, items: listBackups() });
    } catch (err) {
      return reply.code(500).send({ error: `备份失败：${(err as Error).message}` });
    }
  });

  app.get("/system/backups/:name/download", async (request, reply) => {
    const { name } = request.params as { name: string };
    if (!NAME_RE.test(name)) return reply.code(400).send({ error: "非法文件名" });
    const file = path.join(BACKUP_DIR, name);
    if (!fs.existsSync(file)) return reply.code(404).send({ error: "备份不存在" });
    reply.header(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(name)}"`
    );
    reply.type(name.endsWith(".tar.gz") ? "application/gzip" : "application/octet-stream");
    return fs.createReadStream(file);
  });

  app.delete("/system/backups/:name", async (request, reply) => {
    const { name } = request.params as { name: string };
    if (!NAME_RE.test(name)) return reply.code(400).send({ error: "非法文件名" });
    fs.rmSync(path.join(BACKUP_DIR, name), { force: true });
    return { ok: true };
  });
}
