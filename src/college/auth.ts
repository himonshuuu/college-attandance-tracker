import type { Env, CollegeSession } from "../types";
import { browserHeaders, fetchWithRetry, sleep } from "./net";

const SESSION_TTL_MS = 30 * 60 * 1000;
const LOGIN_LOCK_KEY = "college_login_lock";
const LOGIN_LOCK_TTL_MS = 45 * 1000;

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

  // One portal login at a time across all invocations: parallel credential
  // POSTs are the traffic pattern most likely to trip WAF rate limits.
  await acquireLoginLock(env);
  try {
    return await doCollegeLogin(env, enrollmentId);
  } finally {
    await releaseLoginLock(env);
  }
}

/**
 * Cross-invocation mutex via D1 (coarse but effective: logins are rare
 * because sessions are cached 30 min). Fail-open — a stuck lock must
 * never block logins entirely.
 */
async function acquireLoginLock(env: Env): Promise<void> {
  const token = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  for (let i = 0; i < 12; i++) {
    let current: string | null = null;
    try {
      const row = await env.DB.prepare(`SELECT value FROM monitor_state WHERE key = ?`)
        .bind(LOGIN_LOCK_KEY).first<{ value: string }>();
      current = row?.value ?? null;
    } catch {
      return;
    }
    const age = current ? Date.now() - new Date(current.split("|")[0]).getTime() : Infinity;
    if (current === null || isNaN(age) || age > LOGIN_LOCK_TTL_MS) {
      const mine = `${new Date().toISOString()}|${token}`;
      try {
        await env.DB.prepare(`INSERT OR REPLACE INTO monitor_state (key, value) VALUES (?, ?)`)
          .bind(LOGIN_LOCK_KEY, mine).run();
      } catch {
        return;
      }
      await sleep(350);
      try {
        const check = await env.DB.prepare(`SELECT value FROM monitor_state WHERE key = ?`)
          .bind(LOGIN_LOCK_KEY).first<{ value: string }>();
        if (check?.value === mine) return;
      } catch {
        return;
      }
    }
    await sleep(700 + Math.random() * 700);
  }
}

async function releaseLoginLock(env: Env): Promise<void> {
  try {
    await env.DB.prepare(`DELETE FROM monitor_state WHERE key = ?`).bind(LOGIN_LOCK_KEY).run();
  } catch {
    // Best-effort.
  }
}

async function doCollegeLogin(env: Env, enrollmentId: string): Promise<CollegeSession> {
  const body = new URLSearchParams({
    phno: enrollmentId, pass: enrollmentId, ip: "", longitude: "", latitude: "", b1: "",
  });

  let response: Response;
  try {
    response = await fetchWithRetry(env.COLLEGE_LOGIN_URL, {
      method: "POST",
      headers: browserHeaders({
        Accept: "*/*",
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: env.COLLEGE_ORIGIN,
        Referer: env.COLLEGE_LOGIN_REFERER,
      }),
      body,
      redirect: "manual",
    });
  } catch {
    throw new CollegeAuthError("Could not reach the college login endpoint.", "network");
  }

  // A 403 on the login POST is usually the WAF, not bad credentials
  // (bad credentials just re-render the form with HTTP 200). Back off and
  // retry twice before giving up — never invalidate anything here.
  for (let attempt = 0; attempt < 2 && response.status === 403; attempt++) {
    console.error(JSON.stringify({ event: "portal-block-page", endpoint: "login", attempt: attempt + 1 }));
    await sleep(2500 * (attempt + 1) + Math.random() * 1000);
    try {
      response = await fetchWithRetry(env.COLLEGE_LOGIN_URL, {
        method: "POST",
        headers: browserHeaders({
          Accept: "*/*",
          "Content-Type": "application/x-www-form-urlencoded",
          Origin: env.COLLEGE_ORIGIN,
          Referer: env.COLLEGE_LOGIN_REFERER,
        }),
        body,
        redirect: "manual",
      });
    } catch {
      throw new CollegeAuthError("Could not reach the college login endpoint.", "network");
    }
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
