import { env } from "../../config/env";
import { pool } from "../../db/pool";
import { log } from "../../observability/logger";
import { AttendanceHtmlError, parseAttendanceHtml, type AttendanceRecord } from "./attendance.parser";

const SESSION_TTL_MS = 30 * 60 * 1000;
const BROWSER_USER_AGENT = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const BLOCK_MARKERS = ["just a moment", "attention required", "verify you are human", "captcha", "recaptcha", "access denied", "request blocked", "blocked by", "mod_security", "sucuri", "ddos protection", "cloudflare ray", "403 forbidden", "too many requests"];
const LOGIN_MARKERS = ['name="phno"', "name='phno'", 'name="pass"', "name='pass'", 'type="password"'];

export interface StudentProfile {
  name: string;
  className: string;
  stream: string;
  rollNumber: string;
  profilePhotoUrl: string;
}

interface CollegeSession {
  sessionId: string;
  obtainedAt: number;
}

export class CollegePortalError extends Error {
  constructor(message: string, public readonly kind: "config" | "login" | "session" | "network" | "parse") {
    super(message);
    this.name = "CollegePortalError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function browserHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "User-Agent": BROWSER_USER_AGENT,
    "Accept-Language": "en-US,en;q=0.9",
    ...extra,
  };
}

function looksLikeBlockPage(html: string): boolean {
  const lower = html.toLowerCase();
  return BLOCK_MARKERS.some((marker) => lower.includes(marker));
}

function looksLikeLoginPage(html: string): boolean {
  const lower = html.toLowerCase();
  return LOGIN_MARKERS.some((marker) => lower.includes(marker));
}

async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  const transientStatuses = new Set([408, 425, 429, 502, 503, 504]);
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(url, init);
      if (!transientStatuses.has(response.status) || attempt === 3) return response;
      await response.arrayBuffer().catch(() => undefined);
      await sleep(800 * 2 ** attempt + Math.random() * 500);
    } catch (error) {
      if (attempt === 3) throw error;
      await sleep(600 * 2 ** attempt + Math.random() * 400);
    }
  }
  throw new CollegePortalError("College portal request failed.", "network");
}

function validateConfig(): void {
  if (!env.COLLEGE_LOGIN_URL || !env.COLLEGE_LOGIN_REFERER || !env.COLLEGE_PROFILE_URL || !env.COLLEGE_ORIGIN || !env.COLLEGE_REFERER) {
    throw new CollegePortalError("College portal configuration is incomplete.", "config");
  }
}

async function getCachedSession(enrollmentId: string): Promise<CollegeSession | null> {
  const result = await pool.query<{ session_id: string; obtained_at: string }>(
    "SELECT session_id, obtained_at FROM college_sessions WHERE enrollment_id = $1",
    [enrollmentId],
  );
  const row = result.rows[0];
  if (!row) return null;
  const session = { sessionId: row.session_id, obtainedAt: Number(row.obtained_at) };
  return Date.now() - session.obtainedAt < SESSION_TTL_MS ? session : null;
}

async function cacheSession(enrollmentId: string, session: CollegeSession): Promise<void> {
  await pool.query(
    `INSERT INTO college_sessions (enrollment_id, session_id, obtained_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (enrollment_id) DO UPDATE SET session_id = EXCLUDED.session_id, obtained_at = EXCLUDED.obtained_at`,
    [enrollmentId, session.sessionId, session.obtainedAt],
  );
}

async function invalidateSession(enrollmentId: string): Promise<void> {
  await pool.query("DELETE FROM college_sessions WHERE enrollment_id = $1", [enrollmentId]);
}

function extractSessionId(response: Response): string | null {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const cookies = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [response.headers.get("set-cookie") ?? ""];
  const match = cookies.join(", ").match(/(?:^|,\s*)PHPSESSID=([^;,\s]+)/i);
  return match?.[1] ?? null;
}

async function loginToCollege(enrollmentId: string): Promise<CollegeSession> {
  validateConfig();
  log("debug", "college-login-start");
  const body = new URLSearchParams({ phno: enrollmentId, pass: enrollmentId, ip: "", longitude: "", latitude: "", b1: "" });
  let response = await fetchWithRetry(env.COLLEGE_LOGIN_URL!, {
    method: "POST",
    headers: browserHeaders({
      Accept: "*/*",
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: env.COLLEGE_ORIGIN!,
      Referer: env.COLLEGE_LOGIN_REFERER!,
    }),
    body,
    redirect: "manual",
  });

  for (let attempt = 0; attempt < 2 && response.status === 403; attempt++) {
    await sleep(2500 * (attempt + 1) + Math.random() * 1000);
    response = await fetchWithRetry(env.COLLEGE_LOGIN_URL!, {
      method: "POST",
      headers: browserHeaders({
        Accept: "*/*",
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: env.COLLEGE_ORIGIN!,
        Referer: env.COLLEGE_LOGIN_REFERER!,
      }),
      body,
      redirect: "manual",
    });
  }

  const redirected = response.status >= 300 && response.status < 400;
  if (!response.ok && !redirected) throw new CollegePortalError(`College login returned HTTP ${response.status}.`, "login");
  const sessionId = extractSessionId(response);
  if (!sessionId) throw new CollegePortalError("College login did not return a valid session.", "session");
  const session = { sessionId, obtainedAt: Date.now() };
  await cacheSession(enrollmentId, session);
  log("debug", "college-session-cached", { responseStatus: response.status });
  return session;
}

async function getSession(enrollmentId: string): Promise<CollegeSession> {
  const cached = await getCachedSession(enrollmentId);
  return cached ?? loginToCollege(enrollmentId);
}

function profileCellText(value: string): string {
  return value.replace(/<br\s*\/?>(\s*)/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/\s+/g, " ").trim();
}

function profileLabel(value: string): string {
  return profileCellText(value).toLocaleLowerCase("en-US").replace(/[^a-z]/g, "");
}

function parseStudentProfile(html: string, profileUrl: string): StudentProfile {
  const values = new Map<string, string>();
  const rows = html.match(/<tr\b[^>]*>[\s\S]*?<\/tr\s*>/gi) ?? [];
  for (const row of rows) {
    const cells = [...row.matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)\s*>/gi)].map((match) => profileCellText(match[1]));
    if (cells.length < 2) continue;
    const value = cells.slice(1).reverse().find((cell) => cell.length > 0 && cell !== ":");
    if (value) values.set(profileLabel(cells[0]), value);
  }
  const name = values.get("name");
  if (!name) throw new CollegePortalError("College profile page did not contain a name.", "parse");
  const imageSources = [...html.matchAll(/<img\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1/gi)].map((match) => match[2]);
  const imageSource = imageSources.find((source) => /(?:^|[\\/])profile[\\/]/i.test(source));
  let profilePhotoUrl = "";
  if (imageSource) {
    try {
      const url = new URL(imageSource, profileUrl);
      if (url.protocol === "http:" || url.protocol === "https:") profilePhotoUrl = url.toString();
    } catch {
      // A malformed photo URL should not block registration.
    }
  }
  return { name, className: values.get("class") ?? "", stream: values.get("stream") ?? "", rollNumber: values.get("rollno") ?? "", profilePhotoUrl };
}

async function fetchProfilePage(enrollmentId: string, session: CollegeSession): Promise<string> {
  const response = await fetchWithRetry(env.COLLEGE_PROFILE_URL!, {
    method: "GET",
    headers: browserHeaders({
      Accept: "text/html,application/xhtml+xml",
      Cookie: `PHPSESSID=${session.sessionId}`,
      Origin: env.COLLEGE_ORIGIN!,
      Referer: env.COLLEGE_REFERER!,
    }),
  });
  if (response.status === 401 || response.status === 403) {
    await invalidateSession(enrollmentId);
    throw new CollegePortalError("College session is invalid.", "session");
  }
  if (!response.ok) throw new CollegePortalError(`College profile endpoint returned HTTP ${response.status}.`, "network");
  const html = await response.text();
  log("debug", "college-profile-response", { status: response.status, bytes: Buffer.byteLength(html) });
  if (looksLikeBlockPage(html)) throw new CollegePortalError("College portal is rate-limiting requests.", "network");
  if (looksLikeLoginPage(html)) {
    await invalidateSession(enrollmentId);
    throw new CollegePortalError("College session expired.", "session");
  }
  return html;
}

export async function fetchStudentProfile(enrollmentId: string): Promise<StudentProfile> {
  validateConfig();
  const session = await getSession(enrollmentId);
  const html = await fetchProfilePage(enrollmentId, session);
  const profile = parseStudentProfile(html, env.COLLEGE_PROFILE_URL!);
  log("debug", "college-profile-parsed", {
    hasName: Boolean(profile.name),
    hasClass: Boolean(profile.className),
    hasStream: Boolean(profile.stream),
    hasRollNumber: Boolean(profile.rollNumber),
    hasPhoto: Boolean(profile.profilePhotoUrl),
  });
  return profile;
}

export async function fetchStudentAttendance(enrollmentId: string, year: number, month: string): Promise<AttendanceRecord[]> {
  validateConfig();
  if (!env.COLLEGE_ATTENDANCE_URL) throw new CollegePortalError("College attendance configuration is incomplete.", "config");
  const session = await getSession(enrollmentId);
  const form = new FormData();
  form.append("year", String(year));
  form.append("month", month);
  const response = await fetchWithRetry(env.COLLEGE_ATTENDANCE_URL, {
    method: "POST",
    headers: browserHeaders({ Accept: "*/*", Cookie: `PHPSESSID=${session.sessionId}`, Origin: env.COLLEGE_ORIGIN!, Referer: env.COLLEGE_REFERER!, "X-Requested-With": "XMLHttpRequest" }),
    body: form,
  });
  if (response.status === 401 || response.status === 403) {
    await invalidateSession(enrollmentId);
    throw new CollegePortalError("College session is invalid.", "session");
  }
  if (!response.ok) throw new CollegePortalError(`College attendance endpoint returned HTTP ${response.status}.`, "network");
  const html = await response.text();
  log("debug", "college-attendance-response", { year, month, status: response.status, bytes: Buffer.byteLength(html) });
  if (looksLikeBlockPage(html)) throw new CollegePortalError("College portal is rate-limiting requests.", "network");
  if (looksLikeLoginPage(html)) {
    await invalidateSession(enrollmentId);
    throw new CollegePortalError("College session expired.", "session");
  }
  try {
    const records = parseAttendanceHtml(html);
    log("debug", "college-attendance-parsed", { year, month, recordCount: records.length });
    return records;
  } catch (error) {
    if (error instanceof AttendanceHtmlError && error.kind === "missing-table") await invalidateSession(enrollmentId);
    throw new CollegePortalError("College attendance HTML was invalid.", "parse");
  }
}
