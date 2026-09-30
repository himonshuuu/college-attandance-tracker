import { pool } from "../../db/pool";

export interface SnapshotRow {
	name: string;
	total: number;
	present: number;
	absent: number;
	pct: number;
	updated_at: Date;
}

export async function getMonthSnapshots(
	monthKey: string,
	classFilter?: string,
): Promise<SnapshotRow[]> {
	const result = await pool.query<SnapshotRow>(
		`SELECT u.name, s.total, s.present, s.absent, s.pct, s.updated_at
       FROM rank_snapshots s
       JOIN users u ON u.enrollment_id = s.enrollment_id
      WHERE s.month = $1 AND u.active = TRUE
        ${classFilter ? "AND u.class_name = $2" : ""}
      ORDER BY s.rank ASC`,
		classFilter ? [monthKey, classFilter] : [monthKey],
	);
	return result.rows;
}

export async function getDistinctClasses(): Promise<string[]> {
	const result = await pool.query<{ class_name: string }>(
		`SELECT DISTINCT class_name FROM users WHERE active = TRUE AND class_name <> '' ORDER BY class_name`,
	);
	return result.rows.map((r) => r.class_name);
}

export async function countActiveUsers(): Promise<number> {
	const users = await pool.query<{ count: string }>(
		"SELECT count(*) FROM users WHERE active = TRUE",
	);
	return Number(users.rows[0]?.count ?? 0);
}

export async function listActiveEnrollments(): Promise<string[]> {
	const users = await pool.query<{ enrollment_id: string }>(
		"SELECT enrollment_id FROM users WHERE active = TRUE",
	);
	return users.rows.map((row) => row.enrollment_id);
}

export async function getExistingSnapshots(monthKey: string) {
	const existing = await pool.query<{
		enrollment_id: string;
		updated_at: Date;
		total: number;
		present: number;
		absent: number;
		pct: number;
	}>(
		"SELECT enrollment_id, updated_at, total, present, absent, pct FROM rank_snapshots WHERE month = $1",
		[monthKey],
	);
	return existing.rows;
}

export async function getRefreshLease(): Promise<string | null> {
	const lease = await pool.query<{ value: string }>(
		"SELECT value FROM monitor_state WHERE key = 'leaderboard_refresh_at'",
	);
	return lease.rows[0]?.value ?? null;
}

export async function setRefreshLease(nowIso: string): Promise<void> {
	await pool.query(
		"INSERT INTO monitor_state (key, value) VALUES ('leaderboard_refresh_at', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
		[nowIso],
	);
}

export async function upsertSnapshot(
	enrollmentId: string,
	monthKey: string,
	rank: number,
	pct: number,
	total: number,
	present: number,
	absent: number,
): Promise<void> {
	await pool.query(
		`INSERT INTO rank_snapshots (enrollment_id, month, rank, pct, total, present, absent, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (enrollment_id, month) DO UPDATE SET rank = EXCLUDED.rank, pct = EXCLUDED.pct, total = EXCLUDED.total, present = EXCLUDED.present, absent = EXCLUDED.absent, updated_at = EXCLUDED.updated_at`,
		[enrollmentId, monthKey, rank, pct, total, present, absent],
	);
}
