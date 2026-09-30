// Facade over the legacy college PHP portal (login with PHPSESSID + HTML scraping).
import { env } from "../../config/env";
import { log } from "../../observability/logger";
import { sleep } from "../../utils/async";
import {
	AttendanceHtmlError,
	parseAttendanceHtml,
	type AttendanceRecord,
} from "./attendance.parser";
import {
	fetchAttendanceHtml,
	fetchProfileHtml,
	getCollegeSession,
	invalidateSession,
	validateCollegeConfig,
} from "./college.client";
import { CollegePortalError } from "./college.errors";
import type { StudentProfile } from "./college.types";
import { looksLikeBlockPage, looksLikeLoginPage } from "./http";
import { parseStudentProfile, parseSubjectDetails } from "./profile.parser";

// The portal's page selector is a PATH query (?a=1), not a query-string
// param — appending "?a=1" to the profile URL returns the same page.
// COLLEGE_PROFILE_URL already carries ?a=19, so the subjects page needs
// its own URL (COLLEGE_SUBJECTS_URL) rather than string concatenation.
function profilePageUrl(): string {
	return (
		env.COLLEGE_SUBJECTS_URL ??
		(env.COLLEGE_PROFILE_URL ?? "").replace(/[?&]a=\d+.*$/, "") + "?a=1"
	);
}
async function fetchPortalPage(
	enrollmentId: string,
	session: Awaited<ReturnType<typeof getCollegeSession>>,
	url: string,
): Promise<{ html: string; httpStatus: number }> {
	const response = await fetch(url, {
		method: "GET",
		headers: {
			Accept: "text/html,application/xhtml+xml",
			Cookie: `PHPSESSID=${session.sessionId}`,
			Origin: env.COLLEGE_ORIGIN!,
			Referer: env.COLLEGE_REFERER!,
		},
	});
	const html = await response.text();
	if (response.status === 401 || response.status === 403) {
		await invalidateSession(enrollmentId);
		throw new CollegePortalError("College session is invalid.", "session");
	}
	if (!response.ok)
		throw new CollegePortalError(
			`College profile endpoint returned HTTP ${response.status}.`,
			"network",
		);
	return { html, httpStatus: response.status };
}

export async function fetchStudentProfile(
	enrollmentId: string,
): Promise<StudentProfile> {
	validateCollegeConfig();
	const session = await getCollegeSession(enrollmentId);

	// The portal splits data across pages: ?a=19 ("Your Profile") has the
	// personal details table + photo, while ?a=1 ("Update Profile") has the
	// Subject Details card. Fetch both; a missing card on either page is
	// normal for some course variants, so subjects fall back gracefully.
	const profilePage = await fetchPortalPage(
		enrollmentId,
		session,
		env.COLLEGE_PROFILE_URL!,
	);
	if (looksLikeBlockPage(profilePage.html))
		throw new CollegePortalError(
			"College portal is rate-limiting requests.",
			"network",
		);
	if (looksLikeLoginPage(profilePage.html)) {
		await invalidateSession(enrollmentId);
		throw new CollegePortalError("College session expired.", "session");
	}
	const profile = parseStudentProfile(
		profilePage.html,
		env.COLLEGE_PROFILE_URL!,
	);
	// The card itself, not the sidebar link to it — ?a=19 contains the link
	// text "Subject Details" but not the card, so a plain substring match
	// would skip the fallback and leave subjects empty.
	profile.subjects = parseSubjectDetails(profilePage.html);
	const hasSubjectCard = /<h4[^>]*>\s*Subject\s+Details\s*<\/h4\s*>/i.test(
		profilePage.html,
	);

	if (!hasSubjectCard) {
		try {
			await sleep(300); // keep the portal's requests human-paced
			const subjectsPage = await fetchPortalPage(
				enrollmentId,
				session,
				profilePageUrl(),
			);
			if (!looksLikeBlockPage(subjectsPage.html))
				profile.subjects = parseSubjectDetails(subjectsPage.html);
		} catch (error) {
			log("warn", "college-subjects-fallback-failed", {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	log("debug", "college-profile-parsed", {
		hasName: Boolean(profile.name),
		hasClass: Boolean(profile.className),
		hasStream: Boolean(profile.stream),
		hasRollNumber: Boolean(profile.rollNumber),
		hasPhoto: Boolean(profile.profilePhotoUrl),
		subjectCount: profile.subjects.length,
	});
	return profile;
}

export async function fetchStudentAttendance(
	enrollmentId: string,
	year: number,
	month: string,
): Promise<AttendanceRecord[]> {
	validateCollegeConfig();
	const session = await getCollegeSession(enrollmentId);
	const html = await fetchAttendanceHtml(enrollmentId, session, year, month);
	if (looksLikeBlockPage(html))
		throw new CollegePortalError(
			"College portal is rate-limiting requests.",
			"network",
		);
	if (looksLikeLoginPage(html)) {
		await invalidateSession(enrollmentId);
		throw new CollegePortalError("College session expired.", "session");
	}
	try {
		const records = parseAttendanceHtml(html);
		log("debug", "college-attendance-parsed", {
			year,
			month,
			recordCount: records.length,
		});
		return records;
	} catch (error) {
		if (error instanceof AttendanceHtmlError && error.kind === "missing-table")
			await invalidateSession(enrollmentId);
		throw new CollegePortalError(
			"College attendance HTML was invalid.",
			"parse",
		);
	}
}
