import { Hono } from "hono";
import { requireAuth, type HonoEnv } from "../middleware/auth";
import { fetchAttendance } from "../college/api";
import { awardBadges, BADGES, listBadges } from "../engage/badges";
import { computeMonthRanks, currentMonth } from "../engage/ranks";
import { CHECKS_TEXT, computeStreaks, headlineFor, perfectWeeks } from "../engage/stats";

export const engageRouter = new Hono<HonoEnv>();

engageRouter.use("*", requireAuth);

/**
 * Engagement overview for the signed-in user: streaks, milestones, badges,
 * rank and a one-line insight. Powers the profile cards + welcome screen.
 */
engageRouter.get("/overview", async (c) => {
  const session = c.get("session")!;
  const { year, monthName } = currentMonth();

  const user = await c.env.DB.prepare(
    `SELECT id, name, created_at FROM users WHERE enrollment_id = ?`
  ).bind(session.enrollmentId).first<{ id: number; name: string; created_at: string }>();
  if (!user) return c.json({ error: "User not found" }, 404);

  let records;
  try {
    records = await fetchAttendance(c.env, session.enrollmentId, year, monthName);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Failed to fetch attendance" }, 500);
  }

  const total = records.length;
  const present = records.filter((r) => r.status === "Present").length;
  const absent = records.filter((r) => r.status === "Absent").length;
  const pct = total > 0 ? Math.round((present / total) * 100) : 0;
  const streak = computeStreaks(records);
  const weeks = perfectWeeks(records);

  // Rank: prefer the stored daily snapshot, fall back to a live computation.
  let rank: number | null = null;
  let totalStudents = 0;
  try {
    const snap = await c.env.DB.prepare(
      `SELECT rank FROM rank_snapshots WHERE enrollment_id = ? AND month = ?`
    ).bind(session.enrollmentId, `${year}-${monthName}`).first<{ rank: number }>().catch(() => null);
    const count = await c.env.DB.prepare(`SELECT COUNT(*) as n FROM users WHERE active = 1`)
      .first<{ n: number }>().catch(() => ({ n: 0 }));
    totalStudents = count?.n ?? 0;
    if (snap) {
      rank = snap.rank;
    } else if (total > 0) {
      const ranks = await computeMonthRanks(c.env);
      totalStudents = ranks.length;
      rank = ranks.find((r) => r.enrollmentId === session.enrollmentId)?.rank ?? null;
    }
  } catch {
    // Rank is best-effort; the rest of the overview still works.
  }

  const fresh = await awardBadges(c.env, user.id, {
    bestStreak: streak.best,
    currentStreak: streak.current,
    perfectWeeks: weeks,
    totalPresents: present,
    totalAbsents: absent,
    rank,
  });
  const owned = await listBadges(c.env, user.id);
  const badges = BADGES.map((b) => ({ ...b, owned: owned.includes(b.id), isNew: fresh.includes(b.id) }));

  const joinedAt = user.created_at ? new Date(user.created_at).getTime() : 0;
  const joinedRecently = Date.now() - joinedAt < 7 * 24 * 60 * 60 * 1000;

  const friends = await c.env.DB.prepare(
    `SELECT COUNT(*) as n FROM friendships WHERE (user_id = ? OR friend_user_id = ?) AND status = 'accepted'`
  ).bind(user.id, user.id).first<{ n: number }>().catch(() => ({ n: 0 }));

  return c.json({
    month: monthName,
    year,
    total,
    present,
    absent,
    pct,
    streak,
    perfectWeeks: weeks,
    rank,
    totalStudents,
    badges,
    headline: headlineFor(pct, total),
    joinedRecently,
    friendsCount: friends?.n ?? 0,
    checksText: CHECKS_TEXT,
  });
});
