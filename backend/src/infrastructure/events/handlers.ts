import { log } from "../../observability/logger";
import { sendEmail } from "../notifications/email.service";
import { emailCard, escapeHtml } from "../notifications/email.templates";
import {
	notifyAuthError,
	notifyNotUpdated,
	notifyStudent,
	sendPasswordResetEmail,
	sendStreakEmail,
	sendTestNotification,
	sendWelcomeEmail,
} from "../../modules/notifications/notification.service";
import { events } from "./event.bus";

// Called once at startup (server.ts). All notification side effects live
// here — publishers only emit facts about what happened.
export function registerEventHandlers(): void {
	events.subscribe("user.registered", async ({ email, enrollmentId }) => {
		try {
			await sendWelcomeEmail(email, enrollmentId);
		} catch (error) {
			log("warn", "welcome-email-failed", {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	});

	events.subscribe("password.reset.requested", async ({ email, resetLink }) => {
		try {
			await sendPasswordResetEmail(email, resetLink);
		} catch (error) {
			log("warn", "password-reset-email-failed", {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	});

	events.subscribe("subscriptions.updated", async ({ enrollmentId }) => {
		try {
			await sendTestNotification(enrollmentId);
		} catch (error) {
			log("warn", "notification-test-failed", {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	});

	events.subscribe("attendance.marked", ({ student, record }) =>
		notifyStudent(student, record),
	);

	events.subscribe("streak.ended", ({ email, name, streak }) =>
		sendStreakEmail(email, name, "broken", streak),
	);

	events.subscribe("streak.milestone", ({ email, name, streak }) =>
		sendStreakEmail(email, name, "milestone", streak),
	);

	events.subscribe("college.auth.failed", ({ student }) =>
		notifyAuthError(student),
	);

	events.subscribe(
		"attendance.not_updated",
		({ student, subject, teacher, date }) =>
			notifyNotUpdated(student, { subject, teacher, date }),
	);

	events.subscribe("digest.weekly", async (payload) => {
		const {
			email,
			name,
			month,
			year,
			total,
			present,
			absent,
			pct,
			bestStreak,
			currentStreak,
			perfectWeeks,
			rankText,
			badgeNames,
		} = payload;
		const firstName = (name || "there").split(" ")[0];
		await sendEmail(
			email,
			`Your weekly attendance digest — ${pct}% in ${month}`,
			`Hi ${name},\n\nYour week in attendance: ${pct}% (${present}/${total} classes), rank ${rankText}, current streak ${currentStreak}.\n${badgeNames ? `New badges: ${badgeNames}\n` : ""}\n— Attendance Monitor`,
			emailCard({
				heading: `Your week: ${pct}% ${currentStreak >= 3 ? "🔥" : ""}`,
				introHtml: `Hi ${escapeHtml(firstName)}, here's your ${month} summary: <strong>${pct}%</strong> (${present}/${total} classes), ranked <strong>${rankText}</strong>, on a <strong>${currentStreak}-class streak</strong>.`,
				bodyHtml: `<table style="width:100%;border-collapse:collapse;margin-top:4px;background:#f8fafc;border:1px solid #e2e8f0;font-size:13px;"><tr><td style="padding:8px 12px;color:#64748b;">Present</td><td style="padding:8px 12px;color:#16a34a;font-weight:700;">${present}</td></tr><tr><td style="padding:8px 12px;color:#64748b;">Absent</td><td style="padding:8px 12px;color:#dc2626;font-weight:700;">${absent}</td></tr><tr><td style="padding:8px 12px;color:#64748b;">Best streak</td><td style="padding:8px 12px;color:#0f172a;font-weight:700;">${bestStreak} classes</td></tr><tr><td style="padding:8px 12px;color:#64748b;">Perfect weeks</td><td style="padding:8px 12px;color:#0f172a;font-weight:700;">${perfectWeeks}</td></tr></table>${badgeNames ? `<p>🏅 New badges: <strong>${escapeHtml(badgeNames)}</strong></p>` : ""}`,
				footerHtml: `Weekly digest • ${month} ${year} • Attendance Monitor`,
			}),
		);
	});

	events.subscribe(
		"rank.changed",
		async ({ email, name, from, to, total, movedUp }) => {
			const firstName = (name || "there").split(" ")[0];
			await sendEmail(
				email,
				movedUp
					? `You climbed to #${to} on the leaderboard!`
					: `Leaderboard update: you're now #${to}`,
				`${movedUp ? "You climbed" : "You slipped"} from #${from} to #${to} of ${total}.\n\n— Attendance Monitor`,
				emailCard({
					heading: movedUp
						? `You climbed to #${to}! 🎉`
						: `You slipped to #${to}`,
					introHtml: `Hi ${escapeHtml(firstName)}, you moved from #${from} to <strong>#${to} of ${total}</strong> on this month's leaderboard.`,
					footerHtml: "Rank alerts • Attendance Monitor",
				}),
			);
		},
	);
}
