import { AttendanceHtmlError, parseAttendanceHtml } from "./parser";
import { Env, AttendanceRecord } from "./types";

export class CollegeSessionError extends Error {
  constructor(message = "College session appears to have expired.") {
    super(message);
    this.name = "CollegeSessionError";
  }
}

export class CollegeRequestError extends Error {
  constructor(message = "College attendance request failed.") {
    super(message);
    this.name = "CollegeRequestError";
  }
}

export async function fetchAttendance(
  env: Env,
  year: number,
  month: string,
): Promise<AttendanceRecord[]> {
  if (
    !env.COLLEGE_PHPSESSID ||
    !env.COLLEGE_ATTENDANCE_URL ||
    !env.COLLEGE_ORIGIN ||
    !env.COLLEGE_REFERER
  ) {
    throw new CollegeRequestError("College endpoint configuration is incomplete.");
  }

  const form = new FormData();
  form.append("year", String(year));
  form.append("month", month);

  let response: Response;
  try {
    response = await fetch(env.COLLEGE_ATTENDANCE_URL, {
      method: "POST",
      headers: {
        Accept: "*/*",
        Cookie: `PHPSESSID=${env.COLLEGE_PHPSESSID}`,
        Origin: env.COLLEGE_ORIGIN,
        Referer: env.COLLEGE_REFERER,
        "X-Requested-With": "XMLHttpRequest",
      },
      body: form,
    });
  } catch {
    throw new CollegeRequestError("Could not reach the college attendance endpoint.");
  }

  if (response.status === 401 || response.status === 403) {
    throw new CollegeSessionError();
  }
  if (!response.ok) {
    throw new CollegeRequestError(`College endpoint returned HTTP ${response.status}.`);
  }

  let html: string;
  try {
    html = await response.text();
  } catch {
    throw new CollegeRequestError("Could not read the college attendance response.");
  }

  try {
    return parseAttendanceHtml(html);
  } catch (error) {
    if (error instanceof AttendanceHtmlError && error.kind === "missing-table") {
      throw new CollegeSessionError();
    }
    throw new CollegeRequestError("College attendance HTML was invalid.");
  }
}
