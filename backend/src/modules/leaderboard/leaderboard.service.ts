import {
	currentPeriod,
	getCachedAttendance,
} from "../attendance/attendance.service";
import { mapWithConcurrency } from "../../utils/async";
import {
	countActiveUsers,
	getDistinctClasses,
	getExistingSnapshots,
	getMonthSnapshots,
	getRefreshLease,
	listActiveEnrollments,
	setRefreshLease,
	upsertSnapshot,
} from "./leaderboard.repository";

const REFRESH_AFTER_MINUTES = 60;
const REFRESH_LEASE_MINUTES = 5;
const REFRESH_CHUNK = 60;
const REFRESH_CONCURRENCY = 4;

let refreshInProgress: Promise<void> | null = null;

export async function getLeaderboard(classFilter?: string, userClass?: string) {
	const period = currentPeriod();
	const monthKey = `${period.year}-${period.month}`;
	const rows = await getMonthSnapshots(monthKey, classFilter);
	const newest = rows.reduce<Date | null>(
		(value, row) => (!value || row.updated_at > value ? row.updated_at : value),
		null,
	);
	const totalStudents = await countActiveUsers();
	const snapshotCount = rows.length;
	const staleCount = rows.filter(
		(row) =>
			(Date.now() - new Date(row.updated_at).getTime()) / 60000 >
			REFRESH_AFTER_MINUTES,
	).length;
	const pending = staleCount + Math.max(0, totalStudents - snapshotCount);
	void refreshSnapshots().catch((error) =>
		console.error(
			JSON.stringify({
				event: "leaderboard-refresh-failed",
				error: error instanceof Error ? error.message : String(error),
			}),
		),
	);
	return {
		students: rows.map(({ name, total, present, absent, pct }) => ({
			name,
			total,
			present,
			absent,
			pct,
		})),
		month: period.month,
		year: period.year,
		totalStudents: snapshotCount,
		updatedAt: newest?.toISOString() ?? null,
		staleCount: pending,
		refreshing: pending > 0,
		building: snapshotCount === 0 && totalStudents > 0,
		userClass: userClass ?? null,
	};
}

export async function getLeaderboardClasses(): Promise<string[]> {
	return getDistinctClasses();
}

export async function refreshSnapshots(): Promise<void> {
	if (refreshInProgress) return refreshInProgress;
	refreshInProgress = refreshSnapshotsInternal().finally(() => {
		refreshInProgress = null;
	});
	return refreshInProgress;
}

async function refreshSnapshotsInternal(): Promise<void> {
	const period = currentPeriod();
	const monthKey = `${period.year}-${period.month}`;
	const lease = await getRefreshLease();
	if (
		lease &&
		(Date.now() - new Date(lease).getTime()) / 60000 < REFRESH_LEASE_MINUTES
	)
		return;
	await setRefreshLease(new Date().toISOString());

	const enrollments = await listActiveEnrollments();
	const existing = await getExistingSnapshots(monthKey);
	const byEnrollment = new Map(existing.map((row) => [row.enrollment_id, row]));
	const due = enrollments
		.filter((enrollmentId) => {
			const row = byEnrollment.get(enrollmentId);
			return (
				!row ||
				(Date.now() - new Date(row.updated_at).getTime()) / 60000 >
					REFRESH_AFTER_MINUTES
			);
		})
		.slice(0, REFRESH_CHUNK);

	const fresh = await mapWithConcurrency(
		due,
		REFRESH_CONCURRENCY,
		async (enrollmentId) => {
			try {
				const records = await getCachedAttendance(
					enrollmentId,
					period.year,
					period.month,
				);
				const total = records.length;
				const present = records.filter(
					(record) => record.status === "Present",
				).length;
				const absent = records.filter(
					(record) => record.status === "Absent",
				).length;
				return {
					enrollmentId,
					total,
					present,
					absent,
					pct: total ? Math.round((present / total) * 100) : 0,
				};
			} catch {
				return null;
			}
		},
	);

	for (const item of fresh.filter(
		(value): value is NonNullable<typeof value> => value !== null,
	)) {
		byEnrollment.set(item.enrollmentId, {
			enrollment_id: item.enrollmentId,
			updated_at: new Date(),
			total: item.total,
			present: item.present,
			absent: item.absent,
			pct: item.pct,
		});
	}

	const ranked = [...byEnrollment.values()]
		.filter((row) => enrollments.includes(row.enrollment_id))
		.sort(
			(left, right) =>
				right.pct - left.pct ||
				left.enrollment_id.localeCompare(right.enrollment_id),
		);

	for (let index = 0; index < ranked.length; index++) {
		const row = ranked[index];
		await upsertSnapshot(
			row.enrollment_id,
			monthKey,
			index + 1,
			row.pct,
			row.total,
			row.present,
			row.absent,
		);
	}
}
