import type { FastifyInstance } from "fastify";
import { getSetting } from "../db.js";
import type { AiSettings } from "./settings.js";
import { requireAuth } from "../auth.js";

/**
 * AI 写作辅助（后台用）。OpenAI 兼容协议，模型可配置
 * （GLM / DeepSeek / OpenAI / 任何兼容端点）。
 */

type Action = "summary" | "titles" | "polish" | "continue" | "tags";

const PROMPTS: Record<Action, (content: string, extra?: string) => { system: string; user: string }> = {
  summary: (c) => ({
    system: "你是一名中文技术博客编辑。为文章生成 80–140 字的摘要：说清它解决什么问题、核心观点，不用客套话，不以「本文」开头。",
    user: c.slice(0, 12000),
  }),
  titles: (c) => ({
    system: "你是一名中文技术博客编辑。基于文章内容给出 5 个候选标题：具体、有信息量，避免「浅谈/详解/一文读懂」这类套话。每行一个，不要编号。",
    user: c.slice(0, 12000),
  }),
  tags: (c) => ({
    system: "为文章生成 3–6 个标签。只输出标签，用逗号分隔，不要解释。",
    user: c.slice(0, 8000),
  }),
  polish: (c, extra) => ({
    system: `你是一名中文编辑。润色以下文字，保持原意与作者语气，改正错别字与不通顺处，让表达更清晰凝练。${extra ? `额外要求：${extra}。` : ""}只输出润色后的文字。`,
    user: c,
  }),
  continue: (c, extra) => ({
    system: `你是一名中文技术作者。顺着上下文继续写 1–2 段，保持语气与格式（Markdown）一致。${extra ? `额外要求：${extra}。` : ""}只输出续写内容。`,
    user: c.slice(-8000),
  }),
};

interface ChatResponse {
  choices?: { message?: { content?: string } }[];
}

async function callModel(ai: AiSettings, system: string, user: string): Promise<string> {
  const res = await fetch(`${ai.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ai.apiKey}` },
    body: JSON.stringify({
      model: ai.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.7,
    }),
  });
  if (!res.ok) {
    throw new Error(`模型接口返回 ${res.status}：${(await res.text()).slice(0, 300)}`);
  }
  const data = (await res.json()) as ChatResponse;
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("模型未返回内容");
  return text;
}

export async function aiRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", requireAuth);

  app.post("/ai/:action", async (request, reply) => {
    const { action } = request.params as { action: string };
    if (!(action in PROMPTS)) return reply.code(400).send({ error: "未知操作" });
    const { content, extra } = (request.body ?? {}) as { content?: string; extra?: string };
    if (!content?.trim()) return reply.code(400).send({ error: "内容为空" });

    const ai = getSetting<AiSettings>("ai", { baseUrl: "", model: "", apiKey: "" });
    if (!ai.apiKey || !ai.baseUrl) {
      return reply.code(400).send({ error: "请先在「设置」中配置 AI 模型" });
    }
    const { system, user } = PROMPTS[action as Action](content, extra);
    try {
      const result = await callModel(ai, system, user);
      return { result };
    } catch (err) {
      return reply.code(502).send({ error: err instanceof Error ? err.message : "调用失败" });
    }
  });

  // 连通性测试
  app.post("/ai/test", async () => {
    const ai = getSetting<AiSettings>("ai", { baseUrl: "", model: "", apiKey: "" });
    if (!ai.apiKey || !ai.baseUrl) return { ok: false, error: "未配置" };
    try {
      const result = await callModel(ai, "你是一个连通性测试器。", "请回复：OK");
      return { ok: true, sample: result.slice(0, 50) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "调用失败" };
    }
  });
}
