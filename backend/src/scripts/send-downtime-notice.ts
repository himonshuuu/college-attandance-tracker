// One-off ops script: email every active user that Attendance Monitor will be
// offline until the next semester starts, linking to the feedback page.
// Developer: Himangshu Saikia
//
// SAFETY: this never sends unless --send is passed. Without it the script is a
// dry run that only prints who would receive the mail.
//
// Usage:
//   pnpm --dir backend announce:downtime                       # dry run (default)
//   pnpm --dir backend announce:downtime -- --send             # send for real
//   pnpm --dir backend announce:downtime -- --send --limit 10  # safety pilot batch
//   pnpm --dir backend announce:downtime -- --send --delay-ms 1000  # throttle sends
//   pnpm --dir backend announce:downtime -- --mark-sent 300    # mark first N as sent (resume)
//   pnpm --dir backend announce:downtime -- --to you@example.com --send  # single-address test
import { env } from "../config/env";
import { pool } from "../db/pool";
import { sendEmail } from "../infrastructure/notifications/email.service";
import { emailCard, escapeHtml } from "../infrastructure/notifications/email.templates";
import { log } from "../observability/logger";

function argument(name: string): string | undefined {
	const index = process.argv.indexOf(`--${name}`);
	return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(name: string): boolean {
	return process.argv.includes(`--${name}`);
}

const SEND = hasFlag("send");
const DRY_RUN = !SEND;
const LIMIT = Math.max(0, Number(argument("limit") ?? 0)) || null;
const DELAY_MS = Math.max(0, Number(argument("delay-ms") ?? 300));
const MARK_SENT = Math.max(0, Number(argument("mark-sent") ?? 0)) || null;
/** Test helper: send to exactly one address instead of the whole user base. */
const TO = argument("to")?.trim().toLowerCase() || null;

const APP_BASE = (env.APP_URL || "https://attendance.himon.in").replace(/\/+$/, "");
const FEEDBACK_URL = `${APP_BASE}/feedback`;

const SUBJECT = "Attendance Monitor will be down until the next semester";
const SIGNATURE = "Himangshu Saikia\nDeveloper, Attendance Monitor";

function plainText(firstName: string): string {
	return `Hi ${firstName},

Attendance Monitor will be going offline until the next semester starts.

Everything you have saved is safe, and attendance tracking, analytics, the leaderboard, and notifications will resume automatically once the new semester begins.

Before you go: tell us how Attendance Monitor treated you this semester. What worked, what did not, and what should we build next?

${FEEDBACK_URL}

Thank you for using Attendance Monitor — see you next semester!

Why am I receiving this email?
You are receiving this because you have an account on Attendance Monitor with this email address.

Thanks,
${SIGNATURE}`;
}

function htmlCard(firstName: string): string {
	return emailCard({
		heading: "See you next semester 👋",
		introHtml: `Hi ${firstName}, <strong>Attendance Monitor will be going offline until the next semester starts.</strong> Everything you have saved is safe.`,
		button: { label: "Share your feedback", url: FEEDBACK_URL },
		bodyHtml: `<p style="margin:16px 0 0;font-size:14px;color:#0f172a;">Attendance tracking, analytics, the leaderboard, and notifications will resume automatically once the new semester begins — no action needed from you.</p>
			<p style="margin:16px 0 0;font-size:14px;color:#0f172a;">Before you go, tell us how Attendance Monitor treated you this semester: <a href="${FEEDBACK_URL}" style="color:#2563eb;">${FEEDBACK_URL}</a></p>
			<p style="margin:16px 0 0;font-size:12px;color:#64748b;"><strong>Why am I receiving this email?</strong><br/>You are receiving this because you have an account on Attendance Monitor with this email address.</p>
			<p style="margin:16px 0 0;font-size:14px;color:#0f172a;">Thanks,<br/><strong>Himangshu Saikia</strong><br/><span style="font-size:12px;color:#64748b;">Developer, Attendance Monitor</span></p>`,
		footerHtml: "Attendance Monitor • downtime notice",
	});
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
	if (MARK_SENT) {
		const result = await pool.query(
			`UPDATE users SET last_downtime_notice_at = now()
			 WHERE id IN (SELECT id FROM users WHERE active = TRUE ORDER BY id LIMIT $1)`,
			[MARK_SENT],
		);
		console.log(`Marked ${result.rowCount} users as notified`);
		return;
	}

	const result = await pool.query<{
		email: string;
		name: string;
		enrollment_id: string;
	}>(
		TO
			? `SELECT email, name, enrollment_id FROM users
			 WHERE active = TRUE AND lower(email) = $1`
			: `SELECT email, name, enrollment_id FROM users
			 WHERE active = TRUE AND last_downtime_notice_at IS NULL
			 ORDER BY id${LIMIT ? " LIMIT $1" : ""}`,
		TO ? [TO] : LIMIT ? [LIMIT] : [],
	);
	let recipients = result.rows.filter((row) => row.email?.includes("@"));
	// Test address that is not a registered user still receives the mail.
	if (TO && recipients.length === 0) {
		recipients = [{ email: TO, name: "", enrollment_id: "" }];
	}

	log("info", "downtime-notice-start", {
		dryRun: DRY_RUN,
		to: TO,
		feedbackUrl: FEEDBACK_URL,
		recipients: recipients.length,
		skippedNoEmail: result.rows.length - recipients.length,
	});

	let sent = 0;
	const failed: Array<{ email: string; error: string }> = [];

	for (const [index, user] of recipients.entries()) {
		const firstName = escapeHtml((user.name || "there").split(" ")[0]);
		if (DRY_RUN) {
			console.log(
				`[dry-run] ${user.email} (${user.name || user.enrollment_id})`,
			);
			continue;
		}
		try {
			await sendEmail(user.email, SUBJECT, plainText(firstName), htmlCard(firstName));
			// Test sends never touch campaign state, so the real run still hits them.
			if (!TO) {
				await pool.query(
					"UPDATE users SET last_downtime_notice_at = now() WHERE email = $1",
					[user.email],
				);
			}
			log("info", "downtime-notice-email-sent", {
				email: user.email,
				name: user.name,
			});
			sent++;
		} catch (error) {
			failed.push({
				email: user.email,
				error: error instanceof Error ? error.message : String(error),
			});
		}
		if (DELAY_MS > 0 && index < recipients.length - 1) await sleep(DELAY_MS);
	}

	log("info", "downtime-notice-done", {
		dryRun: DRY_RUN,
		sent,
		failed: failed.length,
	});
	if (DRY_RUN) {
		console.log(
			`\nDry run — no mail was sent. Re-run with --send to deliver to ${recipients.length} recipient(s).`,
		);
	}
	for (const entry of failed)
		console.error(`FAILED ${entry.email}: ${entry.error}`);
	if (failed.length > 0 && !DRY_RUN) process.exitCode = 1;
}

void main()
	.catch((error) => {
		log("error", "downtime-notice-fatal", {
			error: error instanceof Error ? error.message : String(error),
		});
		process.exitCode = 1;
	})
	.finally(() => pool.end().catch(() => undefined));
