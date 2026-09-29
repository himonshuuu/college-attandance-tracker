import { pool } from "../../db/pool";
import type { CollegeSession } from "./college.types";

const SESSION_TTL_MS = 30 * 60 * 1000;

export async function getCachedSession(
	enrollmentId: string,
): Promise<CollegeSession | null> {
	const result = await pool.query<{ session_id: string; obtained_at: string }>(
		"SELECT session_id, obtained_at FROM college_sessions WHERE enrollment_id = $1",
		[enrollmentId],
	);
	const row = result.rows[0];
	if (!row) return null;
	const session = {
		sessionId: row.session_id,
		obtainedAt: Number(row.obtained_at),
	};
	return Date.now() - session.obtainedAt < SESSION_TTL_MS ? session : null;
}

export async function cacheSession(
	enrollmentId: string,
	session: CollegeSession,
): Promise<void> {
	await pool.query(
		`INSERT INTO college_sessions (enrollment_id, session_id, obtained_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (enrollment_id) DO UPDATE SET session_id = EXCLUDED.session_id, obtained_at = EXCLUDED.obtained_at`,
		[enrollmentId, session.sessionId, session.obtainedAt],
	);
}

export async function invalidateSession(enrollmentId: string): Promise<void> {
	await pool.query("DELETE FROM college_sessions WHERE enrollment_id = $1", [
		enrollmentId,
	]);
}
