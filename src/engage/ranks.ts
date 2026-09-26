import { getCachedAttendance } from "./cache";
import { mapWithConcurrency } from "./pool";
import { getIndiaDateTime } from "../time";
import type { Env } from "../types";
import { emailCard, escapeHtml } from "../notify/notify";
import { monthKey } from "./stats";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

export interface RankEntry {
  userId: number;
  enrollmentId: string;
  name: string;
  email: string;
  total: number;
  present: number;
  absent: number;
  pct: number;
  rank: number;
}

export function currentMonth(): { year: number; monthName: string; key: string } {
  const now = new Date();
  const monthName = MONTHS[now.getMonth()];
  return { year: now.getFullYear(), monthName, key: monthKey(now.getFullYear(), monthName) };
}

export async function computeMonthRanks(env: Env): Promise<RankEntry[]> {
  const { year, monthName } = currentMonth();
  const users = await env.DB.prepare(
    `SELECT id, name, enrollment_id, email FROM users WHERE active = 1 ORDER BY name`
  ).all<{ id: number; name: string; enrollment_id: string; email: string }>()
    .catch(() => ({ results: [] as { id: number; name: string; enrollment_id: string; email: string }[] }));

  const entries = await mapWithConcurrency(
    users.results,
    8,
    async (u) => {
      try {
        const records = await getCachedAttendance(env, u.enrollment_id, year, monthName);
        const total = records.length;
        const present = records.filter((r) => r.status === "Present").length;
        const absent = records.filter((r) => r.status === "Absent").length;
        const pct = total > 0 ? Math.round((present / total) * 100) : 0;
        return { userId: u.id, enrollmentId: u.enrollment_id, name: u.name, email: u.email, total, present, absent, pct, rank: 0 };
      } catch {
        return { userId: u.id, enrollmentId: u.enrollment_id, name: u.name, email: u.email, total: 0, present: 0, absent: 0, pct: 0, rank: 0 };
      }
    }
  );

  entries.sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name));
  entries.forEach((e, i) => { e.rank = i + 1; });
  return entries;
}

async function sendRankEmail(env: Env, to: string, name: string, prevRank: number, nextRank: number, totalStudents: number): Promise<void> {
  const movedUp = nextRank < prevRank;
  const heading = movedUp ? `You climbed to #${nextRank}! 🎉` : `You slipped to #${nextRank}`;
  const intro = movedUp
    ? `Hi ${escapeHtml(name)}, you moved from #${prevRank} to <strong>#${nextRank} of ${totalStudents}</strong> on this month's leaderboard. Keep attending to hold it!`
    : `Hi ${escapeHtml(name)}, you moved from #${prevRank} to <strong>#${nextRank} of ${totalStudents}</strong>. Attend your next classes to bounce back!`;
  const { sendEmail } = await import("../notify/notify");
  await sendEmail(
    env,
    to,
    movedUp ? `You climbed to #${nextRank} on the leaderboard!` : `Leaderboard update: you're now #${nextRank}`,
    `${heading}\n\n${movedUp ? `You moved from #${prevRank} to #${nextRank} of ${totalStudents}.` : `You moved from #${prevRank} to #${nextRank} of ${totalStudents}. Attend upcoming classes to bounce back.`}\n\n— Attendance Monitor`,
    emailCard({
      heading,
      introHtml: intro,
      footerHtml: "Rank alerts • Attendance Monitor",
    }),
  );
}

/**
 * Compares current ranks with stored snapshots and emails users whose rank
 * changed. Snapshots are scoped per month so a new month starts fresh.
 * Returns the number of rank changes detected.
 */
export async function checkRankChanges(env: Env): Promise<number> {
  const { key } = currentMonth();
  const ranks = await computeMonthRanks(env);
  let changes = 0;

  for (const entry of ranks) {
    if (entry.total === 0) continue;
    try {
      const prev = await env.DB.prepare(
        `SELECT rank FROM rank_snapshots WHERE enrollment_id = ? AND month = ?`
      ).bind(entry.enrollmentId, key).first<{ rank: number }>().catch(() => null);

      if (!prev) {
        // First sighting this month — store silently, no alert.
        await env.DB.prepare(
          `INSERT OR REPLACE INTO rank_snapshots (enrollment_id, month, rank, pct, total, present, absent) VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).bind(entry.enrollmentId, key, entry.rank, entry.pct, entry.total, entry.present, entry.absent).run().catch(() => {});
        continue;
      }

      if (prev.rank !== entry.rank) {
        changes++;
        await env.DB.prepare(
          `INSERT OR REPLACE INTO rank_snapshots (enrollment_id, month, rank, pct, total, present, absent) VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).bind(entry.enrollmentId, key, entry.rank, entry.pct, entry.total, entry.present, entry.absent).run().catch(() => {});
        if (entry.email) {
          await sendRankEmail(env, entry.email, entry.name || "there", prev.rank, entry.rank, ranks.length)
            .catch((err) => console.error(JSON.stringify({ event: "rank-email-failed", error: String(err) })));
        }
      } else if (prev) {
        await env.DB.prepare(`UPDATE rank_snapshots SET pct = ?, total = ?, present = ?, absent = ? WHERE enrollment_id = ? AND month = ?`)
          .bind(entry.pct, entry.total, entry.present, entry.absent, entry.enrollmentId, key).run().catch(() => {});
      }
    } catch (err) {
      console.error(JSON.stringify({ event: "rank-check-failed", error: String(err) }));
    }
  }

  return changes;
}

/** Runs checkRankChanges at most once per IST day (guarded by monitor_state). */
export async function maybeCheckRanksDaily(env: Env): Promise<void> {
  try {
    const today = getIndiaDateTime(new Date()).date;
    const row = await env.DB.prepare(`SELECT value FROM monitor_state WHERE key = 'rank_check_date'`)
      .first<{ value: string }>().catch(() => null);
    if (row && row.value === today) return;
    await checkRankChanges(env);
    await env.DB.prepare(`INSERT OR REPLACE INTO monitor_state (key, value) VALUES ('rank_check_date', ?)`)
      .bind(today).run().catch(() => {});
  } catch (err) {
    console.error(JSON.stringify({ event: "rank-daily-guard-failed", error: String(err) }));
  }
}
