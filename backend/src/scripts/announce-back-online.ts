// One-off ops script: email every active user that the platform is back online.
// Developer: Himangshu Saikia
// Usage:
//   pnpm --dir backend announce:back-online -- --dry-run        # list recipients, send nothing
//   pnpm --dir backend announce:back-online                     # send for real
//   pnpm --dir backend announce:back-online -- --limit 10       # safety pilot batch
//   pnpm --dir backend announce:back-online -- --delay-ms 1000  # throttle sends
import { env } from "../config/env";
import { pool } from "../db/pool";
import { sendEmail } from "../infrastructure/notifications/email.service";
import {
	detailRows,
	emailCard,
	escapeHtml,
} from "../infrastructure/notifications/email.templates";
import { log } from "../observability/logger";

function argument(name: string): string | undefined {
	const index = process.argv.indexOf(`--${name}`);
	return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(name: string): boolean {
	return process.argv.includes(`--${name}`);
}

const DRY_RUN = hasFlag("dry-run");
const LIMIT = Math.max(0, Number(argument("limit") ?? 0)) || null;
const DELAY_MS = Math.max(0, Number(argument("delay-ms") ?? 300));

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
	const result = await pool.query<{
		email: string;
		name: string;
		enrollment_id: string;
	}>(
		`SELECT email, name, enrollment_id FROM users WHERE active = TRUE ORDER BY id${LIMIT ? " LIMIT $1" : ""}`,
		LIMIT ? [LIMIT] : [],
	);
	const recipients = result.rows.filter((row) => row.email?.includes("@"));
	log("info", "back-online-announce-start", {
		dryRun: DRY_RUN,
		recipients: recipients.length,
		skippedNoEmail: result.rows.length - recipients.length,
	});

	const dashboardUrl = env.APP_URL || undefined;
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
			await sendEmail(
				user.email,
				"We're back online — thanks for your patience 💚",
				`Hi ${user.name},\n\nAttendance Monitor is back online — and better than before.\n\nWe have grown to 700+ students, which is amazing, but our old setup was not built for that many people and started slowing down. So we upgraded the system behind the scenes to comfortably handle many more of you.\n\nThanks for bearing with us during the downtime. Your attendance tracking, leaderboard, and notifications have resumed — just open the dashboard to catch up.\n\nWhy am I receiving this email?\nYou are receiving this because you have an account on Attendance Monitor with this email address.\n\nThanks,\nHimangshu Saikia\nDeveloper, Attendance Monitor`,
				emailCard({
					heading: "We're back online 💚",
					introHtml: `Hi ${firstName}, <strong>Attendance Monitor is back online — and better than before.</strong> We have grown to <strong>700+ students</strong>, which is amazing, but our old setup was not built for that many people and started slowing down. So we upgraded the system behind the scenes to comfortably handle many more of you.`,
					button: dashboardUrl
						? { label: "Open your dashboard", url: dashboardUrl }
						: undefined,
					bodyHtml:
						detailRows([
							["Status", "Operational"],
							["Attendance tracking", "Resumed"],
							["Notifications", "Resumed"],
						]) +
						`<p style="margin:16px 0 0;font-size:12px;color:#64748b;"><strong>Why am I receiving this email?</strong><br/>You are receiving this because you have an account on Attendance Monitor with this email address.</p>
						<p style="margin:16px 0 0;font-size:14px;color:#0f172a;">Thanks,<br/><strong>Himangshu Saikia</strong><br/><span style="font-size:12px;color:#64748b;">Developer, Attendance Monitor</span></p>`,
					footerHtml: "Thanks for sticking with us • Attendance Monitor",
				}),
			);
			sent++;
		} catch (error) {
			failed.push({
				email: user.email,
				error: error instanceof Error ? error.message : String(error),
			});
		}
		if (DELAY_MS > 0 && index < recipients.length - 1) await sleep(DELAY_MS);
	}

	log("info", "back-online-announce-done", {
		dryRun: DRY_RUN,
		sent,
		failed: failed.length,
	});
	for (const entry of failed)
		console.error(`FAILED ${entry.email}: ${entry.error}`);
	if (failed.length > 0 && !DRY_RUN) process.exitCode = 1;
}

void main()
	.catch((error) => {
		log("error", "back-online-announce-fatal", {
			error: error instanceof Error ? error.message : String(error),
		});
		process.exitCode = 1;
	})
	.finally(() => pool.end().catch(() => undefined));
