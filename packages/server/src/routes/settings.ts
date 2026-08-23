import type { FastifyInstance } from "fastify";
import { db, getSetting, setSetting } from "../db.js";
import { requireAuth } from "../auth.js";

export interface SiteSettings {
  title: string;
  description: string;
  author: string;
  avatar: string;
  mastheadIntro: string; // 刊头下一行的自我介绍
  footerNote: string; // 页脚书信式落款
  social: { label: string; url: string }[];
  skin: string; // 前台默认皮肤：journal | moss（访客可在导航临时切换）
}

export interface AiSettings {
  baseUrl: string; // OpenAI 兼容端点，如 https://open.bigmodel.cn/api/paas/v4
  model: string;
  apiKey: string;
}

export interface PublishSettings {
  adapter: "local"; // 预留 rsync / cloudflare
  localDir: string;
}

const SITE_DEFAULT: SiteSettings = {
  title: "拾光集",
  description: "一个人的知识库与写作间",
  author: "",
  avatar: "",
  mastheadIntro: "写代码，也写笔记；慢慢建一座自己的图书馆。",
  footerNote: "认真书写，慢慢生长。",
  social: [],
  skin: "journal",
};

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.get("/settings", async () => {
    const site = { ...SITE_DEFAULT, ...getSetting<Partial<SiteSettings>>("site", {}) };
    const ai = getSetting<AiSettings>("ai", {
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      model: "glm-4.7",
      apiKey: "",
    });
    const publish = getSetting<PublishSettings>("publish", {
      adapter: "local",
      localDir: "",
    });
    return {
      site,
      ai: { ...ai, apiKey: "", hasKey: Boolean(ai.apiKey) }, // 不回传明文
      publish,
    };
  });

  app.put("/settings", async (request) => {
    const b = (request.body ?? {}) as {
      site?: Partial<SiteSettings>;
      ai?: Partial<AiSettings>;
      publish?: Partial<PublishSettings>;
    };
    if (b.site) {
      const current = { ...SITE_DEFAULT, ...getSetting<Partial<SiteSettings>>("site", {}) };
      setSetting("site", { ...current, ...b.site });
    }
    if (b.ai) {
      const current = getSetting<AiSettings>("ai", {
        baseUrl: "",
        model: "",
        apiKey: "",
      });
      // apiKey 传空字符串表示不修改
      const apiKey = b.ai.apiKey ? b.ai.apiKey : current.apiKey;
      setSetting("ai", { ...current, ...b.ai, apiKey });
    }
    if (b.publish) {
      const current = getSetting<PublishSettings>("publish", { adapter: "local", localDir: "" });
      setSetting("publish", { ...current, ...b.publish });
    }
    return { ok: true };
  });

  // 账号密码修改
  app.put("/settings/password", async (request, reply) => {
    const { oldPassword, newPassword } = (request.body ?? {}) as {
      oldPassword?: string;
      newPassword?: string;
    };
    if (!newPassword || newPassword.length < 8) {
      return reply.code(400).send({ error: "新密码至少 8 位" });
    }
    const user = db.prepare("SELECT * FROM users LIMIT 1").get() as
      | { id: number; password_hash: string }
      | undefined;
    if (!user) return reply.code(404).send({ error: "尚未初始化账号" });
    const { verifyPassword, hashPassword } = await import("../auth.js");
    if (!(await verifyPassword(user.password_hash, oldPassword ?? ""))) {
      return reply.code(401).send({ error: "原密码不正确" });
    }
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
      await hashPassword(newPassword),
      user.id
    );
    return { ok: true };
  });
}
