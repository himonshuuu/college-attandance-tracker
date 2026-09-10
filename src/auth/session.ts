import type { Env } from "../types";
import { generateToken } from "./crypto";

const SESSION_TTL_DAYS = 15;

interface SessionData {
  userId: number;
  email: string;
  enrollmentId: string;
  createdAt: string;
}

export async function createSession(env: Env, userId: number, email: string, enrollmentId: string): Promise<string> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare(
    `INSERT INTO sessions (token, user_id, email, enrollment_id, expires_at) VALUES (?, ?, ?, ?, ?)`
  ).bind(token, userId, email, enrollmentId, expiresAt).run();
  return token;
}

export async function validateSession(env: Env, token: string): Promise<SessionData | null> {
  const row = await env.DB.prepare(
    `SELECT user_id, email, enrollment_id, expires_at FROM sessions WHERE token = ?`
  ).bind(token).first<{ user_id: number; email: string; enrollment_id: string; expires_at: string }>();
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) {
    await env.DB.prepare(`DELETE FROM sessions WHERE token = ?`).bind(token).run();
    return null;
  }
  return { userId: row.user_id, email: row.email, enrollmentId: row.enrollment_id, createdAt: row.expires_at };
}

export async function destroySession(env: Env, token: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM sessions WHERE token = ?`).bind(token).run();
}

export function getTokenFromRequest(request: Request): string | null {
  const auth = request.headers.get("Authorization");
  if (auth && auth.startsWith("Bearer ")) return auth.slice(7);

  const cookie = request.headers.get("Cookie");
  if (cookie) {
    const match = cookie.match(/(?:^|;\s*)auth_token=([^;]+)/);
    if (match) return decodeURIComponent(match[1]);
  }

  const url = new URL(request.url);
  return url.searchParams.get("token");
}
