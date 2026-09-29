import { pool } from "../../db/pool";
import { log } from "../../observability/logger";
import type { AttendanceRecord } from "../../integrations/college-php-api";

function normalizePayload(payload: unknown): AttendanceRecord[] | null {
	if (Array.isArray(payload)) return payload as AttendanceRecord[];
	if (
		payload &&
		typeof payload === "object" &&
		Array.isArray((payload as { records?: unknown }).records)
	)
		return (payload as { records: AttendanceRecord[] }).records;
	return null;
}

export async function readAttendanceCache(
	enrollmentId: string,
	year: number,
	month: string,
): Promise<{ records: AttendanceRecord[]; fetchedAt: number } | null> {
	try {
		const result = await pool.query<{ payload: unknown; fetched_at: Date }>(
			"SELECT payload, fetched_at FROM attendance_cache WHERE enrollment_id = $1 AND year = $2 AND month = $3",
			[enrollmentId, year, month],
		);
		const parsed = normalizePayload(result.rows[0]?.payload);
		if (!parsed) return null;
		const fetchedAt = result.rows[0]?.fetched_at
			? new Date(result.rows[0].fetched_at).getTime()
			: 0;
		return { records: parsed, fetchedAt };
	} catch (error) {
		log("warn", "attendance-cache-read-failed", {
			year,
			month,
			error: error instanceof Error ? error.message : String(error),
		});
		return null;
	}
}

export async function writeAttendanceCache(
	enrollmentId: string,
	year: number,
	month: string,
	records: AttendanceRecord[],
): Promise<void> {
	try {
		await pool.query(
			`INSERT INTO attendance_cache (enrollment_id, year, month, payload, fetched_at)
       VALUES ($1, $2, $3, $4::jsonb, now())
       ON CONFLICT (enrollment_id, year, month) DO UPDATE SET payload = EXCLUDED.payload, fetched_at = EXCLUDED.fetched_at`,
			[enrollmentId, year, month, JSON.stringify(records)],
		);
	} catch (error) {
		log("warn", "attendance-cache-write-failed", {
			year,
			month,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}
