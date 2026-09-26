import { Hono } from "hono";
import type { HonoEnv } from "../middleware/auth";
import { getCachedAttendance } from "../engage/cache";
import { mapWithConcurrency } from "../engage/pool";
import { currentMonth } from "../engage/ranks";
import { CHECKS_TEXT } from "../engage/stats";

export const leaderboardRouter = new Hono<HonoEnv>();

const REFRESH_CONCURRENCY = 4;
const STALE_AFTER_MIN = 60;
const REFRESH_LEASE_MIN = 5;
const REFRESH_CHUNK = 60;

interface SnapshotRow {
  enrollment_id: string;
  name: string;
  rank: number;
  pct: number;
  total: number;
  present: number;
  absent: number;
  updated_at: string;
}

/**
 * Serves the leaderboard entirely from D1 snapshots (instant, no portal
 * burst), then refreshes stale rows in the background with capped
 * concurrency. Freshness target: under ~1 hour.
 */
leaderboardRouter.get("/", async (c) => {
  const { year, monthName, key } = currentMonth();

  const snap = await c.env.DB.prepare(
    `SELECT s.enrollment_id, u.name, s.rank, s.pct, s.total, s.present, s.absent, s.updated_at
     FROM rank_snapshots s JOIN users u ON u.enrollment_id = s.enrollment_id
     WHERE s.month = ? AND u.active = 1 ORDER BY s.rank ASC`
  ).bind(key).all<SnapshotRow>().catch(() => ({ results: [] as SnapshotRow[] }));

  const now = Date.now();
  const staleCount = snap.results.filter(
    (r) => (now - new Date(r.updated_at).getTime()) / 60000 > STALE_AFTER_MIN
  ).length;
  const newest = snap.results.reduce(
    (acc, r) => (r.updated_at > acc ? r.updated_at : acc),
    ""
  );
  const totalUsers = await c.env.DB.prepare(`SELECT COUNT(*) as n FROM users WHERE active = 1`)
    .first<{ n: number }>().catch(() => ({ n: snap.results.length }));
  const missing = Math.max(0, (totalUsers?.n ?? 0) - snap.results.length);
  const pending = staleCount + missing;

  // Background refresh (never blocks the response).
  c.executionCtx.waitUntil(refreshSnapshots(c.env).catch((err) => {
    console.error(JSON.stringify({ event: "leaderboard-refresh-failed", error: String(err) }));
  }));

  const students = snap.results.map((r) => ({
    name: r.name,
    enrollmentId: r.enrollment_id,
    total: r.total,
    present: r.present,
    absent: r.absent,
    pct: r.pct,
  }));

  return c.json({
    students,
    month: monthName,
    year,
    totalStudents: students.length,
    checksText: CHECKS_TEXT,
    updatedAt: newest || null,
    staleCount: pending,
    refreshing: pending > 0,
    building: students.length === 0 && (totalUsers?.n ?? 0) > 0,
  });
});

/** Refreshes missing/stale snapshots; cooldown-guarded so concurrent views share one refresh. */
export async function refreshSnapshots(env: HonoEnv["Bindings"]): Promise<{ refreshed: number; failed: number }> {
  const { year, monthName, key } = currentMonth();

  try {
    const last = await env.DB.prepare(`SELECT value FROM monitor_state WHERE key = 'leaderboard_refresh_at'`)
      .first<{ value: string }>().catch(() => null);
    if (last && (Date.now() - new Date(last.value).getTime()) / 60000 < REFRESH_LEASE_MIN) {
      return { refreshed: 0, failed: 0 };
    }
    await env.DB.prepare(`INSERT OR REPLACE INTO monitor_state (key, value) VALUES ('leaderboard_refresh_at', ?)`)
      .bind(new Date().toISOString()).run().catch(() => {});
  } catch {
    // Guard is best-effort; proceed with the refresh.
  }

  const users = await env.DB.prepare(`SELECT enrollment_id FROM users WHERE active = 1`)
    .all<{ enrollment_id: string }>().catch(() => ({ results: [] as { enrollment_id: string }[] }));

  const existing = await env.DB.prepare(`SELECT enrollment_id, updated_at FROM rank_snapshots WHERE month = ?`)
    .bind(key).all<{ enrollment_id: string; updated_at: string }>().catch(() => ({ results: [] as { enrollment_id: string; updated_at: string }[] }));
  const ageMin = (updatedAt: string) => (Date.now() - new Date(updatedAt).getTime()) / 60000;
  const byAge = new Map(existing.results.map((r) => [r.enrollment_id, r.updated_at]));
  // Oldest/missing first, bounded per run so background work always finishes fast.
  const due = users.results
    .filter((u) => !byAge.has(u.enrollment_id) || ageMin(byAge.get(u.enrollment_id)!) > STALE_AFTER_MIN)
    .sort((a, b) => {
      const aa = byAge.get(a.enrollment_id);
      const bb = byAge.get(b.enrollment_id);
      if (!aa && !bb) return 0;
      if (!aa) return -1;
      if (!bb) return 1;
      return aa.localeCompare(bb);
    })
    .slice(0, REFRESH_CHUNK);

  const computed = await mapWithConcurrency(due, REFRESH_CONCURRENCY, async (u) => {
    try {
      const records = await getCachedAttendance(env, u.enrollment_id, year, monthName);
      const total = records.length;
      const present = records.filter((r) => r.status === "Present").length;
      const absent = records.filter((r) => r.status === "Absent").length;
      return { enrollmentId: u.enrollment_id, total, present, absent, pct: total > 0 ? Math.round((present / total) * 100) : 0, ok: true as const };
    } catch {
      return { enrollmentId: u.enrollment_id, total: 0, present: 0, absent: 0, pct: 0, ok: false as const };
    }
  });

  // Merge refreshed rows with still-fresh ones, rank, and persist.
  const prevByEid = new Map<string, { total: number; present: number; absent: number; pct: number }>();
  const prevRows = await env.DB.prepare(
    `SELECT enrollment_id, pct, total, present, absent FROM rank_snapshots WHERE month = ?`
  ).bind(key).all<{ enrollment_id: string; pct: number; total: number; present: number; absent: number }>()
    .catch(() => ({ results: [] as { enrollment_id: string; pct: number; total: number; present: number; absent: number }[] }));
  for (const r of prevRows.results) prevByEid.set(r.enrollment_id, r);

  const freshByEid = new Map(computed.filter((x) => x.ok).map((x) => [x.enrollmentId, x]));
  const all = new Map<string, { total: number; present: number; absent: number; pct: number }>();
  for (const u of users.results) {
    const fresh = freshByEid.get(u.enrollment_id);
    if (fresh) {
      all.set(u.enrollment_id, fresh);
    } else if (prevByEid.has(u.enrollment_id)) {
      all.set(u.enrollment_id, prevByEid.get(u.enrollment_id)!);
    } else {
      // Brand-new user with no data yet — listed at zero until the next refresh fills them in.
      all.set(u.enrollment_id, { total: 0, present: 0, absent: 0, pct: 0 });
    }
  }

  const ranked = [...all.entries()]
    .map(([enrollmentId, s]) => ({ enrollmentId, ...s }))
    .sort((a, b) => b.pct - a.pct || a.enrollmentId.localeCompare(b.enrollmentId));

  let refreshed = 0;
  let failed = 0;
  for (let i = 0; i < ranked.length; i++) {
    const r = ranked[i];
    const ok = freshByEid.has(r.enrollmentId) || prevByEid.has(r.enrollmentId);
    if (!ok) {
      failed++;
      continue;
    }
    await env.DB.prepare(
      `INSERT OR REPLACE INTO rank_snapshots (enrollment_id, month, rank, pct, total, present, absent) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(r.enrollmentId, key, i + 1, r.pct, r.total, r.present, r.absent).run().catch(() => { failed++; return null; });
    refreshed++;
  }

  console.log(JSON.stringify({ event: "leaderboard-refresh-done", refreshed, failed }));
  return { refreshed, failed };
}
