import { fetchAttendance } from "../college/api";
import type { AttendanceRecord, Env } from "../types";

const DEFAULT_TTL_MIN = 45;

/**
 * Shared attendance cache: one portal fetch serves many readers
 * (leaderboard, analytics, compare, overview, digest). Stale rows are
 * served only when the portal fetch fails — never a silent zero.
 */
export async function getCachedAttendance(
  env: Env,
  enrollmentId: string,
  year: number,
  monthName: string,
  ttlMin = DEFAULT_TTL_MIN,
): Promise<AttendanceRecord[]> {
  let stale: AttendanceRecord[] | null = null;
  try {
    const row = await env.DB.prepare(
      `SELECT payload, fetched_at FROM attendance_cache WHERE enrollment_id = ? AND year = ? AND month = ?`
    ).bind(enrollmentId, year, monthName).first<{ payload: string; fetched_at: string }>().catch(() => null);
    if (row) {
      const ageMin = (Date.now() - new Date(row.fetched_at).getTime()) / 60000;
      if (ageMin < ttlMin) {
        try {
          return JSON.parse(row.payload) as AttendanceRecord[];
        } catch {
          // Corrupt payload — fall through to a fresh fetch.
        }
      } else {
        try {
          stale = JSON.parse(row.payload) as AttendanceRecord[];
        } catch {
          stale = null;
        }
      }
    }
  } catch {
    // Cache is best-effort; a D1 hiccup must not break reads.
  }

  try {
    const records = await fetchAttendance(env, enrollmentId, year, monthName);
    await storeAttendance(env, enrollmentId, year, monthName, records);
    return records;
  } catch (err) {
    if (stale) return stale;
    throw err;
  }
}

/** Best-effort write-through (used by the monitor after a fresh fetch). */
export async function storeAttendance(
  env: Env,
  enrollmentId: string,
  year: number,
  monthName: string,
  records: AttendanceRecord[],
): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO attendance_cache (enrollment_id, year, month, payload, fetched_at)
       VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`
    ).bind(enrollmentId, year, monthName, JSON.stringify(records)).run();
  } catch {
    // Cache writes must never fail the caller.
  }
}
