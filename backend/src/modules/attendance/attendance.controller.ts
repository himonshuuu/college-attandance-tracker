import type { Request, Response } from "express";
import { fetchStudentProfile } from "../../integrations/college-php-api";
import { findUserByEnrollment } from "../users/users.repository";
import {
	getCachedAttendance,
	resolvePeriod,
	summarize,
} from "./attendance.service";

export async function getAnalytics(request: Request, response: Response) {
	const period = resolvePeriod(
		request.query.month?.toString(),
		request.query.year?.toString(),
	);
	const [profile, records] = await Promise.all([
		fetchStudentProfile(request.session!.enrollmentId),
		getCachedAttendance(
			request.session!.enrollmentId,
			period.year,
			period.month,
			15,
		),
	]);
	const user = await findUserByEnrollment(request.session!.enrollmentId);
	return response.json({
		student: {
			name: profile.name || user?.name || "",
			enrollmentId: request.session!.enrollmentId,
			className: profile.className || user?.class_name || "",
			stream: profile.stream || user?.stream || "",
		},
		month: period.month,
		year: period.year,
		...summarize(records),
		records,
		checksText: "Attendance is read from the shared PostgreSQL cache.",
	});
}
