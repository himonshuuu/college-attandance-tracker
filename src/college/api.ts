import { getSession, invalidateSession, CollegeAuthError } from "./auth";
import { browserHeaders, fetchWithRetry, looksLikeBlockPage, looksLikeLoginPage, sleep } from "./net";
import { parseAttendanceHtml, AttendanceHtmlError } from "./parser";
import type { Env, AttendanceRecord, StudentProfile } from "../types";

export class CollegeRequestError extends Error {
  constructor(
    message: string,
    public readonly kind: "network" | "http" | "parse",
  ) {
    super(message);
    this.name = "CollegeRequestError";
  }
}

export function isCollegeAuthError(error: unknown): error is CollegeAuthError {
  return error instanceof CollegeAuthError;
}

/**
 * Fetches portal HTML with WAF awareness:
 * - block/challenge pages → back off and retry (transient, session untouched)
 * - login form served instead of content → PHP session died (invalidate it)
 * - explicit 401/403 → session invalid (invalidate it)
 */
async function fetchPortalHtml(
  env: Env,
  label: string,
  url: string,
  init: RequestInit,
  enrollmentId: string,
): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    let response: Response;
    try {
      response = await fetchWithRetry(url, init);
    } catch {
      throw new CollegeRequestError(`Could not reach the college ${label} endpoint.`, "network");
    }

    if (response.status === 401 || response.status === 403) {
      await invalidateSession(env, enrollmentId);
      throw new CollegeAuthError("College session is invalid.", "session");
    }
    if (!response.ok) {
      throw new CollegeRequestError(
        `College ${label} endpoint returned HTTP ${response.status}.`,
        "http",
      );
    }

    let html: string;
    try {
      html = await response.text();
    } catch {
      throw new CollegeRequestError(`Could not read the college ${label} response.`, "network");
    }

    if (looksLikeBlockPage(html)) {
      console.error(JSON.stringify({ event: "portal-block-page", endpoint: label, attempt: attempt + 1 }));
      if (attempt < 2) {
        await sleep(2500 * (attempt + 1) + Math.random() * 1000);
        continue;
      }
      throw new CollegeRequestError("College portal is rate-limiting requests.", "http");
    }

    if (looksLikeLoginPage(html)) {
      await invalidateSession(env, enrollmentId);
      throw new CollegeAuthError("College session expired.", "session");
    }

    return html;
  }
  throw new CollegeRequestError(`College ${label} request failed.`, "network");
}

function profileCellText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function profileLabel(value: string): string {
  return profileCellText(value).toLocaleLowerCase("en-US").replace(/[^a-z]/g, "");
}

function parseStudentProfileHtml(html: string, profileUrl: string): StudentProfile {
  const values = new Map<string, string>();
  const rows = html.match(/<tr\b[^>]*>[\s\S]*?<\/tr\s*>/gi) ?? [];

  for (const row of rows) {
    const cells = [...row.matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)\s*>/gi)].map(
      (match) => profileCellText(match[1]),
    );
    if (cells.length < 2) continue;
    const label = profileLabel(cells[0]);
    const value = cells.slice(1).reverse().find((cell) => cell.length > 0 && cell !== ":");
    if (value) values.set(label, value);
  }

  const name = values.get("name");
  if (!name) throw new CollegeRequestError("Profile page did not contain a name.", "parse");

  const imageSources = [
    ...html.matchAll(/<img\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1/gi),
  ].map((match) => match[2]);
  const imageSource = imageSources.find((source) => /(?:^|[\\/])profile[\\/]/i.test(source));

  let profilePhotoUrl = "";
  if (imageSource) {
    try {
      const url = new URL(imageSource, profileUrl);
      if (url.protocol === "http:" || url.protocol === "https:") {
        profilePhotoUrl = url.toString();
      }
    } catch {
      // Malformed photo URL does not invalidate the profile.
    }
  }

  return {
    name,
    className: values.get("class") ?? "",
    stream: values.get("stream") ?? "",
    rollNumber: values.get("rollno") ?? "",
    profilePhotoUrl,
  };
}

export async function fetchStudentProfile(
  env: Env,
  enrollmentId: string,
): Promise<StudentProfile> {
  if (!env.COLLEGE_PROFILE_URL || !env.COLLEGE_ORIGIN || !env.COLLEGE_REFERER) {
    throw new CollegeRequestError("College profile configuration is incomplete.", "network");
  }

  const session = await getSession(env, enrollmentId);

  const html = await fetchPortalHtml(
    env,
    "profile",
    env.COLLEGE_PROFILE_URL,
    {
      method: "GET",
      headers: browserHeaders({
        Accept: "text/html,application/xhtml+xml",
        Cookie: `PHPSESSID=${session.sessionId}`,
        Origin: env.COLLEGE_ORIGIN,
        Referer: env.COLLEGE_REFERER,
      }),
    },
    enrollmentId,
  );

  return parseStudentProfileHtml(html, env.COLLEGE_PROFILE_URL);
}

export async function fetchAttendance(
  env: Env,
  enrollmentId: string,
  year: number,
  month: string,
): Promise<AttendanceRecord[]> {
  if (
    !env.COLLEGE_ATTENDANCE_URL ||
    !env.COLLEGE_ORIGIN ||
    !env.COLLEGE_REFERER
  ) {
    throw new CollegeRequestError("College attendance configuration is incomplete.", "network");
  }

  const session = await getSession(env, enrollmentId);

  const form = new FormData();
  form.append("year", String(year));
  form.append("month", month);

  const html = await fetchPortalHtml(
    env,
    "attendance",
    env.COLLEGE_ATTENDANCE_URL,
    {
      method: "POST",
      headers: browserHeaders({
        Accept: "*/*",
        Cookie: `PHPSESSID=${session.sessionId}`,
        Origin: env.COLLEGE_ORIGIN,
        Referer: env.COLLEGE_REFERER,
        "X-Requested-With": "XMLHttpRequest",
      }),
      body: form,
    },
    enrollmentId,
  );

  try {
    return parseAttendanceHtml(html);
  } catch (error) {
    if (error instanceof AttendanceHtmlError && error.kind === "missing-table") {
      await invalidateSession(env, enrollmentId);
      throw new CollegeAuthError("Attendance table not found — session may be invalid.", "session");
    }
    throw new CollegeRequestError("College attendance HTML was invalid.", "parse");
  }
}
