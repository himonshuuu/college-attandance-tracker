import type { Env, CollegeSession } from "../types";

const SESSION_TTL_MS = 30 * 60 * 1000;

export class CollegeAuthError extends Error {
  constructor(
    message: string,
    public readonly kind: "config" | "login" | "session" | "network",
  ) {
    super(message);
    this.name = "CollegeAuthError";
  }
}

function isSessionValid(session: CollegeSession): boolean {
  return Date.now() - session.obtainedAt < SESSION_TTL_MS;
}

export async function getCachedSession(env: Env, enrollmentId: string): Promise<CollegeSession | null> {
  try {
    const row = await env.DB.prepare(
      `SELECT session_id, obtained_at FROM college_sessions WHERE enrollment_id = ?`
    ).bind(enrollmentId).first<{ session_id: string; obtained_at: number }>();
    if (!row) return null;
    const session: CollegeSession = { sessionId: row.session_id, obtainedAt: row.obtained_at };
    if (isSessionValid(session)) return session;
    return null;
  } catch { return null; }
}

export async function cacheSession(env: Env, enrollmentId: string, session: CollegeSession): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO college_sessions (enrollment_id, session_id, obtained_at) VALUES (?, ?, ?)
       ON CONFLICT(enrollment_id) DO UPDATE SET session_id = excluded.session_id, obtained_at = excluded.obtained_at`
    ).bind(enrollmentId, session.sessionId, session.obtainedAt).run();
  } catch { /* Non-fatal */ }
}

export async function invalidateSession(env: Env, enrollmentId: string): Promise<void> {
  try { await env.DB.prepare(`DELETE FROM college_sessions WHERE enrollment_id = ?`).bind(enrollmentId).run(); }
  catch { /* Non-fatal */ }
}

function extractSessionId(setCookie: string | null): string | null {
  if (!setCookie) return null;
  const match = setCookie.match(/(?:^|,\s*)PHPSESSID=([^;,\s]+)/i);
  return match?.[1] ?? null;
}

function validateConfig(env: Env): void {
  if (!env.COLLEGE_LOGIN_URL || !env.COLLEGE_LOGIN_REFERER || !env.COLLEGE_ORIGIN) {
    throw new CollegeAuthError("College login configuration is incomplete.", "config");
  }
}

export async function loginToCollege(env: Env, enrollmentId: string): Promise<CollegeSession> {
  validateConfig(env);
  if (!enrollmentId || enrollmentId.length > 100) {
    throw new CollegeAuthError("Invalid enrollment ID.", "config");
  }

  const body = new URLSearchParams({
    phno: enrollmentId, pass: enrollmentId, ip: "", longitude: "", latitude: "", b1: "",
  });

  let response: Response;
  try {
    response = await fetch(env.COLLEGE_LOGIN_URL, {
      method: "POST",
      headers: {
        Accept: "*/*",
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: env.COLLEGE_ORIGIN,
        Referer: env.COLLEGE_LOGIN_REFERER,
      },
      body,
      redirect: "manual",
    });
  } catch {
    throw new CollegeAuthError("Could not reach the college login endpoint.", "network");
  }

  const redirectResponse = response.status >= 300 && response.status < 400;
  if (!response.ok && !redirectResponse) {
    throw new CollegeAuthError(`College login returned HTTP ${response.status}.`, "login");
  }

  const setCookieValues =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie") ?? ""];

  const sessionId = extractSessionId(setCookieValues.join(", "));
  if (!sessionId) {
    throw new CollegeAuthError("College login did not return a valid session.", "session");
  }

  const session: CollegeSession = { sessionId, obtainedAt: Date.now() };
  await cacheSession(env, enrollmentId, session);
  return session;
}

export async function getSession(env: Env, enrollmentId: string): Promise<CollegeSession> {
  const cached = await getCachedSession(env, enrollmentId);
  if (cached) return cached;
  return loginToCollege(env, enrollmentId);
}
