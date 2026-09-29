import { Router } from "express";
import { pool } from "../../db/pool";
import { currentPeriod, getCachedAttendance } from "../attendance/attendance.service";

const REFRESH_AFTER_MINUTES = 60;
const REFRESH_LEASE_MINUTES = 5;
const REFRESH_CHUNK = 60;
const REFRESH_CONCURRENCY = 4;
let refreshInProgress: Promise<void> | null = null;

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

export const leaderboardRouter = Router();

leaderboardRouter.get("/", async (_request, response) => {
  const period = currentPeriod();
  const monthKey = `${period.year}-${period.month}`;
  const result = await pool.query<{ name: string; total: number; present: number; absent: number; pct: number; updated_at: Date }>(
    `SELECT u.name, s.total, s.present, s.absent, s.pct, s.updated_at
       FROM rank_snapshots s
       JOIN users u ON u.enrollment_id = s.enrollment_id
      WHERE s.month = $1 AND u.active = TRUE
      ORDER BY s.rank ASC`,
    [monthKey],
  );
  const newest = result.rows.reduce<Date | null>((value, row) => !value || row.updated_at > value ? row.updated_at : value, null);
  const users = await pool.query<{ count: string }>("SELECT count(*) FROM users WHERE active = TRUE");
  const totalStudents = Number(users.rows[0]?.count ?? 0);
  const snapshotCount = result.rowCount ?? 0;
  const staleCount = result.rows.filter((row) => (Date.now() - new Date(row.updated_at).getTime()) / 60000 > REFRESH_AFTER_MINUTES).length;
  const pending = staleCount + Math.max(0, totalStudents - snapshotCount);
  void refreshSnapshots().catch((error) => console.error(JSON.stringify({ event: "leaderboard-refresh-failed", error: error instanceof Error ? error.message : String(error) })));
  return response.json({
    students: result.rows.map(({ name, total, present, absent, pct }) => ({ name, total, present, absent, pct })),
    month: period.month,
    year: period.year,
    totalStudents: snapshotCount,
    updatedAt: newest?.toISOString() ?? null,
    staleCount: pending,
    refreshing: pending > 0,
    building: snapshotCount === 0 && totalStudents > 0,
  });
});

async function refreshSnapshots(): Promise<void> {
  if (refreshInProgress) return refreshInProgress;
  refreshInProgress = refreshSnapshotsInternal().finally(() => { refreshInProgress = null; });
  return refreshInProgress;
}

async function refreshSnapshotsInternal(): Promise<void> {
  const period = currentPeriod();
  const monthKey = `${period.year}-${period.month}`;
  const lease = await pool.query<{ value: string }>("SELECT value FROM monitor_state WHERE key = 'leaderboard_refresh_at'");
  if (lease.rows[0] && (Date.now() - new Date(lease.rows[0].value).getTime()) / 60000 < REFRESH_LEASE_MINUTES) return;
  await pool.query("INSERT INTO monitor_state (key, value) VALUES ('leaderboard_refresh_at', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [new Date().toISOString()]);

  const users = await pool.query<{ enrollment_id: string }>("SELECT enrollment_id FROM users WHERE active = TRUE");
  const existing = await pool.query<{ enrollment_id: string; updated_at: Date; total: number; present: number; absent: number; pct: number }>("SELECT enrollment_id, updated_at, total, present, absent, pct FROM rank_snapshots WHERE month = $1", [monthKey]);
  const byEnrollment = new Map(existing.rows.map((row) => [row.enrollment_id, row]));
  const due = users.rows.filter((user) => {
    const row = byEnrollment.get(user.enrollment_id);
    return !row || (Date.now() - new Date(row.updated_at).getTime()) / 60000 > REFRESH_AFTER_MINUTES;
  }).slice(0, REFRESH_CHUNK);
  const fresh = await mapWithConcurrency(due, REFRESH_CONCURRENCY, async (user) => {
    try {
      const records = await getCachedAttendance(user.enrollment_id, period.year, period.month);
      const total = records.length;
      const present = records.filter((record) => record.status === "Present").length;
      const absent = records.filter((record) => record.status === "Absent").length;
      return { enrollmentId: user.enrollment_id, total, present, absent, pct: total ? Math.round((present / total) * 100) : 0 };
    } catch {
      return null;
    }
  });
  for (const item of fresh.filter((value): value is NonNullable<typeof value> => value !== null)) {
    byEnrollment.set(item.enrollmentId, { enrollment_id: item.enrollmentId, updated_at: new Date(), total: item.total, present: item.present, absent: item.absent, pct: item.pct });
  }
  const ranked = [...byEnrollment.values()].filter((row) => users.rows.some((user) => user.enrollment_id === row.enrollment_id)).sort((left, right) => right.pct - left.pct || left.enrollment_id.localeCompare(right.enrollment_id));
  for (let index = 0; index < ranked.length; index++) {
    const row = ranked[index];
    await pool.query(
      `INSERT INTO rank_snapshots (enrollment_id, month, rank, pct, total, present, absent, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (enrollment_id, month) DO UPDATE SET rank = EXCLUDED.rank, pct = EXCLUDED.pct, total = EXCLUDED.total, present = EXCLUDED.present, absent = EXCLUDED.absent, updated_at = EXCLUDED.updated_at`,
      [row.enrollment_id, monthKey, index + 1, row.pct, row.total, row.present, row.absent],
    );
  }
}
