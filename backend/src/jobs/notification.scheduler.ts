import { pool } from "../db/pool";
import { events } from "../infrastructure/events/event.bus";
import { getCachedAttendance } from "../modules/attendance/attendance.service";
import {
	awardBadges,
	BADGES,
	computeStreaks,
	perfectWeeks,
} from "../modules/engagement/engagement.service";
import { log } from "../observability/logger";
import { sleep } from "../utils/async";
import { currentIndiaTime, runMonitorCycle } from "./monitor.service";

let scheduledWork: Promise<void> | null = null;
let lastMinute = "";

async function runCacheWarm(): Promise<void> {
	const now = currentIndiaTime();
	const users = await pool.query<{ enrollment_id: string }>(
		"SELECT enrollment_id FROM users WHERE active = TRUE ORDER BY id",
	);
	let warmed = 0;
	let failed = 0;
	for (const user of users.rows) {
		try {
			await getCachedAttendance(user.enrollment_id, now.year, now.monthName, 0);
			warmed++;
		} catch {
			failed++;
		}
		await sleep(250);
	}
	log("info", "cache-warm-done", { warmed, failed });
}

async function runWeeklyDigest(): Promise<void> {
	const now = currentIndiaTime();
	const users = await pool.query<{
		id: number;
		name: string;
		email: string;
		enrollment_id: string;
	}>(
		"SELECT id, name, email, enrollment_id FROM users WHERE active = TRUE ORDER BY id",
	);
	const rankRows = await pool.query<{
		enrollment_id: string;
		rank: number;
		total: number;
		pct: number;
	}>(
		"SELECT enrollment_id, rank, total, pct FROM rank_snapshots WHERE month = $1",
		[`${now.year}-${now.monthName}`],
	);
	const rankMap = new Map(rankRows.rows.map((row) => [row.enrollment_id, row]));
	let sent = 0;
	let errors = 0;
	for (const user of users.rows) {
		try {
			const records = await getCachedAttendance(
				user.enrollment_id,
				now.year,
				now.monthName,
			);
			const total = records.length;
			const present = records.filter(
				(record) => record.status === "Present",
			).length;
			const absent = records.filter(
				(record) => record.status === "Absent",
			).length;
			const pct = total ? Math.round((present / total) * 100) : 0;
			const streak = computeStreaks(records);
			const weeks = perfectWeeks(records);
			const rank = rankMap.get(user.enrollment_id);
			const fresh = await awardBadges(user.id, {
				bestStreak: streak.best,
				currentStreak: streak.current,
				perfectWeeks: weeks,
				totalPresents: present,
				totalAbsents: absent,
				rank: rank?.rank ?? null,
			});
			const badgeNames = fresh
				.map((id) => BADGES.find((badge) => badge.id === id))
				.filter(Boolean)
				.map((badge) => `${badge!.icon} ${badge!.name}`)
				.join(", ");
			const rankText = rank
				? `#${rank.rank} of ${users.rowCount ?? users.rows.length}`
				: "—";
			await events.publish("digest.weekly", {
				email: user.email,
				name: user.name,
				month: now.monthName,
				year: now.year,
				total,
				present,
				absent,
				pct,
				bestStreak: streak.best,
				currentStreak: streak.current,
				perfectWeeks: weeks,
				rankText,
				badgeNames,
			});
			sent++;
		} catch (error) {
			errors++;
			log("error", "digest-user-failed", {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
	log("info", "weekly-digest-done", { sent, errors });
}

async function checkRankChanges(): Promise<void> {
	const now = currentIndiaTime();
	const guard = await pool.query<{ value: string }>(
		"SELECT value FROM monitor_state WHERE key = 'rank_check_date'",
	);
	if (guard.rows[0]?.value === now.date) return;
	const users = await pool.query<{
		enrollment_id: string;
		name: string;
		email: string;
	}>("SELECT enrollment_id, name, email FROM users WHERE active = TRUE");
	const calculated: Array<{
		enrollmentId: string;
		name: string;
		email: string;
		rank: number;
		pct: number;
		total: number;
		present: number;
		absent: number;
	}> = [];
	for (const user of users.rows) {
		try {
			const records = await getCachedAttendance(
				user.enrollment_id,
				now.year,
				now.monthName,
			);
			const total = records.length;
			const present = records.filter(
				(record) => record.status === "Present",
			).length;
			const absent = records.filter(
				(record) => record.status === "Absent",
			).length;
			calculated.push({
				enrollmentId: user.enrollment_id,
				name: user.name,
				email: user.email,
				rank: 0,
				pct: total ? Math.round((present / total) * 100) : 0,
				total,
				present,
				absent,
			});
		} catch {
			calculated.push({
				enrollmentId: user.enrollment_id,
				name: user.name,
				email: user.email,
				rank: 0,
				pct: 0,
				total: 0,
				present: 0,
				absent: 0,
			});
		}
	}
	calculated.sort(
		(left, right) =>
			right.pct - left.pct || left.name.localeCompare(right.name),
	);
	for (let index = 0; index < calculated.length; index++)
		calculated[index].rank = index + 1;
	const month = `${now.year}-${now.monthName}`;
	for (const entry of calculated) {
		if (!entry.total) continue;
		const previous = await pool.query<{ rank: number }>(
			"SELECT rank FROM rank_snapshots WHERE enrollment_id = $1 AND month = $2",
			[entry.enrollmentId, month],
		);
		await pool.query(
			`INSERT INTO rank_snapshots (enrollment_id, month, rank, pct, total, present, absent, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, now()) ON CONFLICT (enrollment_id, month) DO UPDATE SET rank = EXCLUDED.rank, pct = EXCLUDED.pct, total = EXCLUDED.total, present = EXCLUDED.present, absent = EXCLUDED.absent, updated_at = EXCLUDED.updated_at`,
			[
				entry.enrollmentId,
				month,
				entry.rank,
				entry.pct,
				entry.total,
				entry.present,
				entry.absent,
			],
		);
		const prior = previous.rows[0]?.rank;
		if (prior && prior !== entry.rank && entry.email) {
			await events.publish("rank.changed", {
				email: entry.email,
				name: entry.name,
				from: prior,
				to: entry.rank,
				total: calculated.length,
				movedUp: entry.rank < prior,
			});
		}
	}
	await pool.query(
		"INSERT INTO monitor_state (key, value) VALUES ('rank_check_date', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
		[now.date],
	);
}

async function runScheduledWork(
	now: ReturnType<typeof currentIndiaTime>,
): Promise<void> {
	const minute = now.hour * 60 + now.minute;
	const monitorSlot =
		now.weekday !== "Sunday" &&
		(minute === 9 * 60 + 15 ||
			minute === 9 * 60 + 30 ||
			minute === 9 * 60 + 45 ||
			(minute >= 10 * 60 && minute <= 16 * 60 + 15 && minute % 15 === 0) ||
			minute === 16 * 60 + 30 ||
			minute === 16 * 60 + 45);
	if (monitorSlot) {
		await runMonitorCycle();
		await checkRankChanges();
	}
	if (minute === 2 * 60 + 30) await runCacheWarm();
	if (now.weekday === "Monday" && minute === 7 * 60) await runWeeklyDigest();
}

export function startNotificationScheduler(): NodeJS.Timeout {
	return setInterval(() => {
		const now = currentIndiaTime();
		const key = `${now.date}|${now.hour}|${now.minute}`;
		if (key === lastMinute) return;
		lastMinute = key;
		if (scheduledWork) return;
		scheduledWork = runScheduledWork(now)
			.catch((error) =>
				log("error", "scheduled-notification-work-failed", {
					error: error instanceof Error ? error.message : String(error),
				}),
			)
			.finally(() => {
				scheduledWork = null;
			});
	}, 30_000);
}
