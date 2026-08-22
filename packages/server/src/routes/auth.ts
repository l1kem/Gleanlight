import type { FastifyInstance } from "fastify";
import { db } from "../db.js";
import { verifyPassword, setSessionCookie, clearSessionCookie } from "../auth.js";

interface LoginBody {
  username?: string;
  password?: string;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // 登录接口单独限速：15 分钟窗口内最多 5 次（auth guard 之前挂）
  app.post(
    "/login",
    { config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      const { username, password } = (request.body ?? {}) as LoginBody;
      if (!username || !password) {
        return reply.code(400).send({ error: "请输入用户名和密码" });
      }
      const user = db
        .prepare("SELECT id, username, password_hash FROM users WHERE username = ?")
        .get(username) as { id: number; username: string; password_hash: string } | undefined;
      // 无论用户是否存在都执行一次校验，避免时序侧信道
      const ok = user
        ? await verifyPassword(user.password_hash, password)
        : await verifyPassword("$argon2id$v=19$m=8192,t=3,p=1$invalidinvalidinvalid$invalid", password).catch(() => false);
      if (!user || !ok) {
        return reply.code(401).send({ error: "用户名或密码不正确" });
      }
      const token = await reply.jwtSign({ uid: user.id, username: user.username });
      setSessionCookie(reply, token);
      return { id: user.id, username: user.username };
    }
  );

  app.post("/logout", async (_request, reply) => {
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get("/me", async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.code(401).send({ error: "未登录" });
    }
    const payload = await request.jwtVerify<{ uid: number; username: string }>();
    return { id: payload.uid, username: payload.username };
  });
}
