// One-off ops script: re-fetch every active user's college portal profile
// (name, class, stream, roll, photo + subjects) and update the users table.
// Run after deploying migration 002_user_subjects.sql.
//
// Usage:
//   pnpm --dir backend backfill:profiles -- --dry-run        # fetch only, update nothing
//   pnpm --dir backend backfill:profiles -- --limit 5        # safety pilot batch
//   pnpm --dir backend backfill:profiles                     # full run
//   pnpm --dir backend backfill:profiles -- --delay-ms 1000  # be gentler on the portal
import { pool } from "../db/pool";
import { runMigrations } from "../db/migrations";
import { withTransaction } from "../db/pool";
import { log } from "../observability/logger";
import {
	CollegePortalError,
	fetchStudentProfile,
} from "../integrations/college-php-api";
import {
	fetchProfileHtml,
	getCollegeSession,
} from "../integrations/college-php-api/college.client";
import {
	looksLikeBlockPage,
	looksLikeLoginPage,
} from "../integrations/college-php-api/http";
import { updateUserProfile } from "../modules/users/users.repository";

function argument(name: string): string | undefined {
	const index = process.argv.indexOf(`--${name}`);
	return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(name: string): boolean {
	return process.argv.includes(`--${name}`);
}

const DRY_RUN = hasFlag("dry-run");
const LIMIT = Math.max(0, Number(argument("limit") ?? 0)) || null;
const DELAY_MS = Math.max(0, Number(argument("delay-ms") ?? 500));

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
	// Migrations first so the subjects column always exists before we write it.
	await withTransaction(async (client) => runMigrations(client));

	const inspectId = argument("inspect");
	if (inspectId) {
		await inspectProfilePage(inspectId);
		return;
	}

	const result = await pool.query<{
		enrollment_id: string;
		email: string;
	}>(
		`SELECT enrollment_id, email FROM users WHERE active = TRUE ORDER BY id${LIMIT ? " LIMIT $1" : ""}`,
		LIMIT ? [LIMIT] : [],
	);
	log("info", "profile-backfill-start", {
		dryRun: DRY_RUN,
		users: result.rows.length,
	});

	let updated = 0;
	let noSubjects = 0;
	const failed: Array<{ enrollmentId: string; error: string }> = [];

	for (const [index, user] of result.rows.entries()) {
		try {
			const profile = await fetchStudentProfile(user.enrollment_id);
			if (DRY_RUN) {
				console.log(
					`[dry-run] ${user.enrollment_id} (${profile.name}): ${profile.subjects.flatMap((s) => s.courses).join(" | ") || "no subjects"}`,
				);
			} else {
				await updateUserProfile(user.enrollment_id, profile);
				updated++;
			}
			if (profile.subjects.length === 0) noSubjects++;
		} catch (error) {
			failed.push({
				enrollmentId: user.enrollment_id,
				error:
					error instanceof CollegePortalError
						? `[${error.kind}] ${error.message}`
						: error instanceof Error
							? error.message
							: String(error),
			});
		}
		if (DELAY_MS > 0 && index < result.rows.length - 1) await sleep(DELAY_MS);
	}

	log("info", "profile-backfill-done", {
		dryRun: DRY_RUN,
		updated,
		noSubjects,
		failed: failed.length,
	});
	for (const entry of failed)
		console.error(`FAILED ${entry.enrollmentId}: ${entry.error}`);
	if (failed.length > 0 && !DRY_RUN) process.exitCode = 1;
}

// Usage addition:
//   pnpm --dir backend backfill:profiles -- --inspect <enrollmentId>
// Prints why a user gets "no subjects": shows whether the raw portal page
// even contains the Subject Details card, or if it is a login/block page.
async function inspectProfilePage(enrollmentId: string): Promise<void> {
	const session = await getCollegeSession(enrollmentId);
	const html = await fetchProfileHtml(enrollmentId, session);
	console.log(`bytes: ${Buffer.byteLength(html)}`);
	console.log(`looksLikeLoginPage: ${looksLikeLoginPage(html)}`);
	console.log(`looksLikeBlockPage: ${looksLikeBlockPage(html)}`);
	const cardIndex = html.search(/subject\s+details/i);
	console.log(`subjectDetailsIndex: ${cardIndex}`);
	if (cardIndex >= 0) {
		console.log("--- card context ---");
		console.log(
			html
				.slice(Math.max(0, cardIndex - 200), cardIndex + 1500)
				.replace(/\s+/g, " "),
		);
	} else {
		const title = html
			.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1]
			?.trim();
		console.log(`title: ${title ?? "(none)"}`);
		console.log(
			"hint: page has no Subject Details card for this student (different ?a= page variant?), or the card markup differs — paste the card HTML to extend the parser.",
		);
	}
}

void main()
	.catch((error) => {
		log("error", "profile-backfill-fatal", {
			error: error instanceof Error ? error.message : String(error),
		});
		process.exitCode = 1;
	})
	.finally(() => pool.end().catch(() => undefined));
