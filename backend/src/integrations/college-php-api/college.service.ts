// Facade over the legacy college PHP portal (login with PHPSESSID + HTML scraping).
import { env } from "../../config/env";
import { log } from "../../observability/logger";
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
import { parseStudentProfile } from "./profile.parser";

export async function fetchStudentProfile(
	enrollmentId: string,
): Promise<StudentProfile> {
	validateCollegeConfig();
	const session = await getCollegeSession(enrollmentId);
	const html = await fetchProfileHtml(enrollmentId, session);
	if (looksLikeBlockPage(html))
		throw new CollegePortalError(
			"College portal is rate-limiting requests.",
			"network",
		);
	if (looksLikeLoginPage(html)) {
		await invalidateSession(enrollmentId);
		throw new CollegePortalError("College session expired.", "session");
	}
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
