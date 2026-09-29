import { env } from "../../config/env";
import { log } from "../../observability/logger";
import { CollegePortalError } from "./college.errors";
import type { CollegeSession } from "./college.types";
import {
	browserHeaders,
	extractSessionId,
	fetchWithRetry,
	sleep,
} from "./http";
import {
	cacheSession,
	getCachedSession,
	invalidateSession,
} from "./session.store";

export function validateCollegeConfig(): void {
	if (
		!env.COLLEGE_LOGIN_URL ||
		!env.COLLEGE_LOGIN_REFERER ||
		!env.COLLEGE_PROFILE_URL ||
		!env.COLLEGE_ORIGIN ||
		!env.COLLEGE_REFERER
	) {
		throw new CollegePortalError(
			"College portal configuration is incomplete.",
			"config",
		);
	}
}

async function loginToCollege(enrollmentId: string): Promise<CollegeSession> {
	validateCollegeConfig();
	log("debug", "college-login-start");
	const body = new URLSearchParams({
		phno: enrollmentId,
		pass: enrollmentId,
		ip: "",
		longitude: "",
		latitude: "",
		b1: "",
	});

	const loginOnce = () =>
		fetchWithRetry(env.COLLEGE_LOGIN_URL!, {
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

	let response = await loginOnce();
	for (let attempt = 0; attempt < 2 && response.status === 403; attempt++) {
		await sleep(2500 * (attempt + 1) + Math.random() * 1000);
		response = await loginOnce();
	}

	const redirected = response.status >= 300 && response.status < 400;
	if (!response.ok && !redirected)
		throw new CollegePortalError(
			`College login returned HTTP ${response.status}.`,
			"login",
		);
	const sessionId = extractSessionId(response);
	if (!sessionId)
		throw new CollegePortalError(
			"College login did not return a valid session.",
			"session",
		);
	const session = { sessionId, obtainedAt: Date.now() };
	await cacheSession(enrollmentId, session);
	log("debug", "college-session-cached", { responseStatus: response.status });
	return session;
}

export async function getCollegeSession(
	enrollmentId: string,
): Promise<CollegeSession> {
	const cached = await getCachedSession(enrollmentId);
	return cached ?? loginToCollege(enrollmentId);
}

// Raw HTML fetchers — parsing lives in profile.parser.ts / attendance.parser.ts.
export async function fetchProfileHtml(
	enrollmentId: string,
	session: CollegeSession,
): Promise<string> {
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
	if (!response.ok)
		throw new CollegePortalError(
			`College profile endpoint returned HTTP ${response.status}.`,
			"network",
		);
	const html = await response.text();
	log("debug", "college-profile-response", {
		status: response.status,
		bytes: Buffer.byteLength(html),
	});
	return html;
}

export async function fetchAttendanceHtml(
	enrollmentId: string,
	session: CollegeSession,
	year: number,
	month: string,
): Promise<string> {
	if (!env.COLLEGE_ATTENDANCE_URL)
		throw new CollegePortalError(
			"College attendance configuration is incomplete.",
			"config",
		);
	const form = new FormData();
	form.append("year", String(year));
	form.append("month", month);
	const response = await fetchWithRetry(env.COLLEGE_ATTENDANCE_URL, {
		method: "POST",
		headers: browserHeaders({
			Accept: "*/*",
			Cookie: `PHPSESSID=${session.sessionId}`,
			Origin: env.COLLEGE_ORIGIN!,
			Referer: env.COLLEGE_REFERER!,
			"X-Requested-With": "XMLHttpRequest",
		}),
		body: form,
	});
	if (response.status === 401 || response.status === 403) {
		await invalidateSession(enrollmentId);
		throw new CollegePortalError("College session is invalid.", "session");
	}
	if (!response.ok)
		throw new CollegePortalError(
			`College attendance endpoint returned HTTP ${response.status}.`,
			"network",
		);
	const html = await response.text();
	log("debug", "college-attendance-response", {
		year,
		month,
		status: response.status,
		bytes: Buffer.byteLength(html),
	});
	return html;
}

export { invalidateSession };
