import type { FastifyInstance } from "fastify";
import path from "node:path";
import { db, getSetting, setSetting, backupDb } from "../db.js";
import { requireAuth } from "../auth.js";
import { exportContent } from "../builder/exporter.js";
import { runSiteBuild } from "../builder/build.js";
import { adapters } from "../builder/adapters/index.js";
import { PKG_SITE, PUBLIC_DIST } from "../config.js";
import { runHealthChecks, formatPrecheck } from "../lib/checks.js";
import type { PublishSettings } from "./settings.js";

/** 发布中心：预检 → 导出 → 构建 → 部署，异步执行，前端轮询日志 */

export async function publishRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.post("/publish", async (_request, reply) => {
    const running = db
      .prepare("SELECT id FROM builds WHERE status = 'running'")
      .get() as { id: number } | undefined;
    if (running) return reply.code(409).send({ error: "已有构建正在进行", buildId: running.id });

    return reply.code(202).send({ buildId: startPublish("manual") });
  });

  app.get("/builds", async () => {
    return {
      items: db
        .prepare("SELECT id, status, adapter, created_at, finished_at FROM builds ORDER BY id DESC LIMIT 20")
        .all(),
      publicDist: PUBLIC_DIST,
    };
  });

  app.get("/builds/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = db.prepare("SELECT * FROM builds WHERE id = ?").get(Number(id));
    if (!row) return reply.code(404).send({ error: "构建不存在" });
    return row;
  });

  // 删除单条构建记录（进行中的不允许删）
  app.delete("/builds/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const row = db.prepare("SELECT status FROM builds WHERE id = ?").get(Number(id)) as
      | { status: string }
      | undefined;
    if (!row) return reply.code(404).send({ error: "构建不存在" });
    if (row.status === "running") return reply.code(409).send({ error: "构建进行中，不能删除" });
    db.prepare("DELETE FROM builds WHERE id = ?").run(Number(id));
    return { ok: true };
  });

  // 清空历史（保留进行中的）
  app.delete("/builds", async () => {
    const info = db.prepare("DELETE FROM builds WHERE status != 'running'").run();
    return { ok: true, deleted: info.changes };
  });
}

/**
 * 执行一次完整发布（预检 → 备份 → 导出 → 构建 → 部署）。
 * 手动发布与定时发布共用；source 记入日志便于区分。
 */
export function startPublish(source: "manual" | "scheduled"): number {
  const running = db
    .prepare("SELECT id FROM builds WHERE status = 'running' ORDER BY id DESC LIMIT 1")
    .get() as { id: number } | undefined;
  if (running) {
    if (source === "scheduled") setSetting("publish_pending", true);
    return running.id;
  }

  const pub = getSetting<PublishSettings>("publish", {
    adapter: "local",
    localDir: "",
    rsyncTarget: "",
    cfProject: "",
  });
  const adapter = adapters[pub.adapter] ?? adapters.local;

  const info = db
    .prepare("INSERT INTO builds(status, adapter) VALUES('running', ?)")
    .run(adapter.name);
  const buildId = Number(info.lastInsertRowid);
  setSetting("publish_pending", false);

  const logLines: string[] = [];
  const log = (line: string) => {
    logLines.push(line);
    db.prepare("UPDATE builds SET log = ? WHERE id = ?").run(logLines.join("\n"), buildId);
  };

  // 异步执行：发布耗时长（astro build），不阻塞调用方
  void (async () => {
    const started = Date.now();
    try {
      log(`[0/3] 发布前预检${source === "scheduled" ? "（定时触发）" : ""} …`);
      for (const line of formatPrecheck(runHealthChecks())) log(line);
      await backupDb(); // 每次发布前自动备份 SQLite（WAL 一致快照）
      log(`[1/3] 导出内容 …`);
      const { postCount, mediaCount, skippedUnsafeMedia } = exportContent();
      log(`      已导出 ${postCount} 篇文章、${mediaCount} 个公开附件`);
      if (skippedUnsafeMedia > 0) {
        log(`      ⚠ 跳过 ${skippedUnsafeMedia} 个 SVG 附件；请转为 PNG/WebP 后重新引用`);
      }
      log(`[2/3] astro build（静态化前台）…`);
      await runSiteBuild(log);
      log(`[3/3] 部署（${adapter.name}）…`);
      const target = await adapter.deploy(path.join(PKG_SITE, "dist"), log);
      log(`完成：${target}（耗时 ${((Date.now() - started) / 1000).toFixed(1)}s）`);
      db.prepare(
        "UPDATE builds SET status='success', finished_at=datetime('now') WHERE id=?"
      ).run(buildId);
    } catch (err) {
      log(`失败：${err instanceof Error ? err.message : String(err)}`);
      db.prepare(
        "UPDATE builds SET status='failed', finished_at=datetime('now') WHERE id=?"
      ).run(buildId);
    } finally {
      // 构建期间到点的定时文章可能错过本次导出；结束后补跑一次，避免静态站漏发。
      if (getSetting<boolean>("publish_pending", false)) {
        setSetting("publish_pending", false);
        setImmediate(() => startPublish("scheduled"));
      }
    }
  })();

  return buildId;
}

/**
 * 定时发布扫描：把到点的定时草稿转为已发布，并触发一次构建。
 * 由 index.ts 每分钟调用；无到点文章时零开销（一次索引查询）。
 */
export function promoteScheduledPosts(): void {
  const due = db
    .prepare(
      `SELECT id, title FROM posts
       WHERE status='draft' AND scheduled_at IS NOT NULL AND scheduled_at <= datetime('now')`
    )
    .all() as { id: number; title: string }[];
  if (due.length === 0) return;

  const promote = db.prepare(
    `UPDATE posts SET status='published',
       published_at=COALESCE(published_at, datetime('now')),
       scheduled_at=NULL
     WHERE id = ?`
  );
  for (const p of due) promote.run(p.id);
  console.log(`[scheduler] ${due.length} 篇定时文章到点发布：${due.map((p) => p.title).join("、")}`);

  const running = db.prepare("SELECT id FROM builds WHERE status = 'running'").get();
  if (running) {
    setSetting("publish_pending", true);
    console.log("[scheduler] 已有构建进行中，已排队在结束后补跑");
    return;
  }
  startPublish("scheduled");
}

/** 进程异常退出会遗留 running 记录；启动时收口并恢复待补跑任务。 */
export function recoverInterruptedBuilds(): boolean {
  const info = db
    .prepare(
      `UPDATE builds
       SET status='failed', finished_at=datetime('now'),
           log=log || '\n失败：服务进程在构建期间中断'
       WHERE status='running'`,
    )
    .run();
  return info.changes > 0 || getSetting<boolean>("publish_pending", false);
}
