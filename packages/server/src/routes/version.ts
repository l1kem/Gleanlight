import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../config.js";
import { requireAuth } from "../auth.js";

const REPO = "l1kem/Gleanlight";
const RELEASES_URL = `https://github.com/${REPO}/releases`;

interface ReleaseInfo {
  version: string;
  name: string;
  publishedAt: string;
  url: string;
  notes: string;
}

function currentVersion(): string {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
    version: string;
  };
  return pkg.version;
}

export async function versionRoutes(app: FastifyInstance): Promise<void> {
  app.get("/version", { preHandler: requireAuth }, async () => ({
    current: currentVersion(),
  }));

  // 检查 GitHub 最新版本；网络不可达时优雅降级（返回 error 字段而不是抛 500）
  // releases/latest 对预发布版/无 release 返回 404，逐级回退：latest → releases 列表 → tags
  app.get("/version/check", { preHandler: requireAuth }, async () => {
    const current = currentVersion();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const gh = async (path: string): Promise<unknown | null> => {
      const res = await fetch(`https://api.github.com/repos/${REPO}/${path}`, {
        headers: { "User-Agent": "Gleanlight", Accept: "application/vnd.github+json" },
        signal: ctrl.signal,
      });
      if (!res.ok) return null;
      return res.json();
    };
    try {
      let latest: ReleaseInfo | null = null;

      const relLatest = (await gh("releases/latest")) as {
        tag_name?: string;
        name?: string;
        published_at?: string;
        html_url?: string;
        body?: string;
      } | null;
      if (relLatest?.tag_name) {
        latest = {
          version: relLatest.tag_name.replace(/^v/, ""),
          name: relLatest.name ?? "",
          publishedAt: relLatest.published_at ?? "",
          url: relLatest.html_url ?? RELEASES_URL,
          notes: (relLatest.body ?? "").slice(0, 600),
        };
      }

      if (!latest) {
        const relList = (await gh("releases?per_page=1")) as { tag_name?: string }[] | null;
        if (Array.isArray(relList) && relList[0]?.tag_name) {
          latest = {
            version: relList[0].tag_name.replace(/^v/, ""),
            name: "",
            publishedAt: "",
            url: RELEASES_URL,
            notes: "",
          };
        }
      }

      if (!latest) {
        const tags = (await gh("tags?per_page=1")) as { name?: string }[] | null;
        const tag = Array.isArray(tags) ? tags[0]?.name?.replace(/^v/, "") : undefined;
        if (tag) {
          latest = { version: tag, name: "", publishedAt: "", url: RELEASES_URL, notes: "" };
        }
      }

      if (!latest) {
        return {
          current,
          latest: null,
          updateAvailable: null,
          error: "仓库还没有发布过版本（Release / Tag）。",
          url: RELEASES_URL,
        };
      }
      return {
        current,
        latest,
        updateAvailable: latest.version ? latest.version !== current : null,
      };
    } catch {
      return {
        current,
        latest: null,
        updateAvailable: null,
        error: "暂时连不上 GitHub（网络受限环境常见），不影响使用。",
        url: RELEASES_URL,
      };
    } finally {
      clearTimeout(timer);
    }
  });
}
