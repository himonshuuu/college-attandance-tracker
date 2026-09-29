// Orchestrator facade — transports live in src/infrastructure/notifications,
// background jobs in src/jobs, college portal in src/integrations/college-php-api.
import { log } from "../../observability/logger";
import { fetchStudentProfile } from "../../integrations/college-php-api";
import { getCachedAttendance } from "../attendance/attendance.service";
import { notifyDiscord } from "../../infrastructure/notifications/discord.service";
import { sendEmail } from "../../infrastructure/notifications/email.service";
import {
	detailRows,
	emailCard,
	escapeHtml,
} from "../../infrastructure/notifications/email.templates";
import { getSubscriptions } from "./notification.repository";
import type {
	AttendanceLike,
	NotificationUser,
} from "../../infrastructure/notifications/notification.types";
import { sendFcmNotification } from "../../infrastructure/notifications/push.service";

export type { AttendanceLike, NotificationUser };
export {
	getSubscriptions,
	sendEmail,
	escapeHtml,
	emailCard,
	sendFcmNotification,
	notifyDiscord,
};

export async function notifyStudent(
	student: NotificationUser,
	record: AttendanceLike,
): Promise<void> {
	await notifyDiscord(student, record);
	const subscriptions = await getSubscriptions(student.enrollment_id);
	const present = record.status === "Present";
	const title = present ? "🟢 Present" : "🔴 Absent";
	const subject = record.subject ?? "Attendance";
	const body = `${subject} — ${record.teacher ?? ""}\n${record.date} ${record.classTiming ?? ""}`;
	for (const subscription of subscriptions) {
		try {
			if (subscription.method === "email" && subscription.email) {
				const status = (record.status ?? "Marked").toUpperCase();
				const badge = present
					? "background:#dcfce7;color:#15803d;"
					: "background:#fee2e2;color:#b91c1c;";
				await sendEmail(
					subscription.email,
					`${title} — ${subject}`,
					`Hi ${student.name},\n\nYou were marked ${status} for ${subject}.\n\nDate: ${record.date}\nTime: ${record.classTiming ?? "—"}\nTeacher: ${record.teacher ?? "—"}\n\n— Attendance Monitor`,
					emailCard({
						heading: `${title} — ${escapeHtml(subject)}`,
						introHtml: `Hi ${escapeHtml(student.name)}, you were marked <strong>${status}</strong> for <strong>${escapeHtml(subject)}</strong>.`,
						bodyHtml: `<div style="margin-top:4px;"><span style="display:inline-block;padding:4px 12px;border-radius:12px;font-size:12px;font-weight:700;${badge}">${status}</span></div>${detailRows(
							[
								["Date", escapeHtml(record.date)],
								["Time", escapeHtml(record.classTiming ?? "—")],
								["Teacher", escapeHtml(record.teacher ?? "—")],
							],
						)}`,
					}),
				);
			} else if (
				subscription.method === "browser" &&
				subscription.push_subscription
			) {
				await sendFcmNotification(subscription.push_subscription, title, body, {
					enrollmentId: student.enrollment_id,
					subject,
					status: record.status ?? "",
					date: record.date,
				});
			}
		} catch (error) {
			log("error", "notification-failed", {
				method: subscription.method,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
}

export {
	notifyAuthError,
	notifyNotUpdated,
} from "../../infrastructure/notifications/discord.service";

export async function sendWelcomeEmail(
	email: string,
	enrollmentId: string,
): Promise<void> {
	await sendEmail(
		email,
		"Welcome to Attendance Monitor",
		`Hi,\n\nWelcome to Attendance Monitor! Your account has been created.\n\nEnrollment ID: ${enrollmentId}\n\nYou will now receive notifications when your attendance is marked in class.\n\n— Attendance Monitor`,
		emailCard({
			heading: "Welcome to Attendance Monitor",
			introHtml:
				"Your account has been created. You will now receive notifications when your attendance is marked in class.",
			bodyHtml: detailRows([
				["Email", escapeHtml(email)],
				["Enrollment ID", escapeHtml(enrollmentId)],
			]),
		}),
	);
}

export async function sendPasswordResetEmail(
	email: string,
	resetLink: string,
): Promise<void> {
	await sendEmail(
		email,
		"Reset your Attendance Monitor password",
		`Hi,\n\nWe received a request to reset the password for your Attendance Monitor account (${email}).\n\nReset your password using this link (valid for 1 hour, single use):\n${resetLink}\n\nDidn't ask for this? Someone may have typed your email by mistake — just ignore and delete this email. Your password stays the same.\n\n— Attendance Monitor`,
		emailCard({
			heading: "Reset your password",
			introHtml: `We received a request to reset the password for <strong>${escapeHtml(email)}</strong>. Click the button below (valid for 1 hour, single use):`,
			button: { label: "Reset password", url: resetLink },
			bodyHtml: `<p style="margin:16px 0 0;font-size:12px;color:#94a3b8;word-break:break-all;">Or copy this link:<br/>${escapeHtml(resetLink)}</p>
				<p style="margin:16px 0 0;padding:12px;border-radius:10px;background:#f8fafc;font-size:13px;color:#475569;"><strong>Didn't ask for this?</strong> Someone may have typed your email by mistake — just ignore and delete this email. Your password stays the same.</p>`,
			footerHtml:
				"If you did not request this, you can safely ignore this email.",
		}),
	);
}

export async function sendStreakEmail(
	email: string,
	name: string,
	kind: "broken" | "milestone",
	streak: number,
): Promise<void> {
	const firstName = escapeHtml((name || "there").split(" ")[0]);
	const broken = kind === "broken";
	await sendEmail(
		email,
		broken
			? "Your attendance streak ended — start a new one 💪"
			: `${streak}-class attendance streak! 🔥`,
		broken
			? `Hi ${name},\n\nYour ${streak}-class attendance streak just ended with an absent.\n\n— Attendance Monitor`
			: `Hi ${name},\n\nAmazing — you've attended ${streak} classes in a row! Keep it going.\n\n— Attendance Monitor`,
		emailCard({
			heading: broken
				? `Streak ended at ${streak} 🔥`
				: `${streak}-class streak! 🔥`,
			introHtml: broken
				? `Hi ${firstName}, your <strong>${streak}-class streak</strong> just ended with an absent. Attend the next class to start a fresh streak!`
				: `Hi ${firstName}, amazing consistency — you've attended <strong>${streak} classes in a row</strong>!`,
			footerHtml: "Streak update • Attendance Monitor",
		}),
	);
}

export async function sendMonthlyReportEmail(
	studentEmail: string,
	enrollmentId: string,
	monthName?: string,
	year?: number,
): Promise<void> {
	const date = new Date();
	const months = [
		"January",
		"February",
		"March",
		"April",
		"May",
		"June",
		"July",
		"August",
		"September",
		"October",
		"November",
		"December",
	];
	const month = monthName ?? months[date.getMonth()];
	const reportYear = year ?? date.getFullYear();
	let profile = { name: "Student", className: "—", stream: "—" };
	let records: AttendanceLike[] = [];
	try {
		const [studentProfile, attendance] = await Promise.all([
			fetchStudentProfile(enrollmentId),
			getCachedAttendance(enrollmentId, reportYear, month),
		]);
		profile = studentProfile;
		records = attendance;
	} catch (error) {
		log("warn", "monthly-report-data-failed", {
			error: error instanceof Error ? error.message : String(error),
		});
	}
	const total = records.length;
	const present = records.filter(
		(record) => record.status === "Present",
	).length;
	const absent = records.filter((record) => record.status === "Absent").length;
	const pct = total ? Math.round((present / total) * 100) : 0;
	const subjectMap = new Map<
		string,
		{ present: number; absent: number; total: number }
	>();
	for (const record of records) {
		const entry = subjectMap.get(record.subject ?? "Unknown") ?? {
			present: 0,
			absent: 0,
			total: 0,
		};
		entry.total++;
		if (record.status === "Present") entry.present++;
		if (record.status === "Absent") entry.absent++;
		subjectMap.set(record.subject ?? "Unknown", entry);
	}
	const subjectRows = [...subjectMap.entries()]
		.sort(
			([, left], [, right]) =>
				left.present / Math.max(1, left.total) -
				right.present / Math.max(1, right.total),
		)
		.map(
			([name, value]) =>
				`<tr><td style="padding:10px;border-bottom:1px solid #e2e8f0;font-weight:600;">${escapeHtml(name)}</td><td style="padding:10px;color:#16a34a;">${value.present}</td><td style="padding:10px;color:#dc2626;">${value.absent}</td><td style="padding:10px;">${value.total}</td><td style="padding:10px;font-weight:700;">${Math.round((value.present / Math.max(1, value.total)) * 100)}%</td></tr>`,
		)
		.join("");
	const recordRows = records
		.slice(0, 30)
		.map(
			(record) =>
				`<tr><td style="padding:8px 10px;">${escapeHtml(record.date)}</td><td style="padding:8px 10px;font-weight:500;">${escapeHtml(record.subject ?? "—")}</td><td style="padding:8px 10px;">${escapeHtml(record.teacher ?? "—")}</td><td style="padding:8px 10px;">${escapeHtml(record.classTiming ?? "—")}</td><td style="padding:8px 10px;">${escapeHtml(record.status ?? "—")}</td></tr>`,
		)
		.join("");
	const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:650px;margin:0 auto;padding:24px;background:#fff;border:1px solid #e2e8f0;border-radius:16px;"><h2 style="color:#0f172a;">Monthly Attendance Report</h2><p style="color:#475569;">Official attendance summary for <strong>${month} ${reportYear}</strong> — ${escapeHtml(profile.name)} (${escapeHtml(enrollmentId)}).</p>${detailRows(
		[
			["Student Name", escapeHtml(profile.name)],
			["Enrollment ID", escapeHtml(enrollmentId)],
			["Class & Section", escapeHtml(profile.className)],
			["Stream", escapeHtml(profile.stream)],
			["Total", String(total)],
			["Present", String(present)],
			["Absent", String(absent)],
			["Score", `${pct}%`],
		],
	)}<h3 style="margin-top:24px;color:#1e293b;">Subject-wise Breakdown</h3><table style="width:100%;border-collapse:collapse;font-size:12px;"><tr style="background:#f1f5f9;"><th style="text-align:left;padding:8px;">Subject</th><th style="text-align:left;padding:8px;">Present</th><th style="text-align:left;padding:8px;">Absent</th><th style="text-align:left;padding:8px;">Total</th><th style="text-align:left;padding:8px;">Score</th></tr>${subjectRows || '<tr><td colspan="5">No subject records found</td></tr>'}</table><h3 style="margin-top:24px;color:#1e293b;">Recent Class Records (${total} Total)</h3><table style="width:100%;border-collapse:collapse;font-size:11px;"><tr style="background:#f1f5f9;"><th style="text-align:left;padding:8px;">Date</th><th style="text-align:left;padding:8px;">Subject</th><th style="text-align:left;padding:8px;">Teacher</th><th style="text-align:left;padding:8px;">Time</th><th style="text-align:left;padding:8px;">Status</th></tr>${recordRows || '<tr><td colspan="5">No records found</td></tr>'}</table><p style="color:#94a3b8;">— Attendance Monitor</p></div>`;
	await sendEmail(
		studentEmail,
		`Monthly Attendance Report - ${month} ${reportYear}`,
		`Monthly Attendance Report for ${profile.name} (${month} ${reportYear}): Overall Attendance: ${pct}% (${present}/${total} classes).`,
		html,
	);
}

export async function sendTestNotification(
	enrollmentId: string,
): Promise<Record<string, unknown>> {
	const result: Record<string, unknown> = {};
	for (const subscription of await getSubscriptions(enrollmentId)) {
		try {
			if (subscription.method === "email" && subscription.email) {
				await sendEmail(
					subscription.email,
					"Test Notification",
					"Your attendance notifications are working! You will receive alerts here when your attendance is marked.\n\n— Attendance Monitor",
					emailCard({
						heading: "Notifications are working",
						introHtml:
							"Your attendance notifications are working! You will receive alerts here when your attendance is marked.",
						bodyHtml: detailRows([["Enrollment ID", escapeHtml(enrollmentId)]]),
					}),
				);
				result.email = true;
			} else if (
				subscription.method === "monthly_report" &&
				subscription.email
			) {
				await sendMonthlyReportEmail(subscription.email, enrollmentId);
				result.monthly_report = true;
			} else if (
				subscription.method === "browser" &&
				subscription.push_subscription
			) {
				await sendFcmNotification(
					subscription.push_subscription,
					"Firebase Notifications Working",
					"You will receive real-time attendance alerts on this device.",
					{ test: "true" },
				);
				result.browser = true;
			}
		} catch (error) {
			const errors = (result.errors as Array<unknown> | undefined) ?? [];
			errors.push({
				method: subscription.method,
				message: error instanceof Error ? error.message : String(error),
			});
			result.errors = errors;
		}
	}
	return result;
}
