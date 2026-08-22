import { hash, verify } from "@node-rs/argon2";
import type { FastifyReply, FastifyRequest } from "fastify";
import { COOKIE_NAME, SESSION_TTL_SEC } from "./config.js";

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, {});
}

export async function verifyPassword(hashStr: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashStr, plain);
  } catch {
    return false;
  }
}

/** 登录成功后写入 httpOnly 会话 cookie */
export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(COOKIE_NAME, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    // secure 仅在反代提供 HTTPS 时开启；直连 http 时保持关闭
    secure: process.env.BLOG_HTTPS === "1",
    maxAge: SESSION_TTL_SEC,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(COOKIE_NAME, { path: "/" });
}

/** 路由守卫：校验 JWT，失败返回 401 */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    void reply.code(401).send({ error: "未登录或会话已过期" });
  }
}
