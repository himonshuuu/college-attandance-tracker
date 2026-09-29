import { Router } from "express";
import { requireAuth } from "../auth/session";
import { currentPeriod, getCachedAttendance, summarize } from "../attendance/attendance.service";
import { pool } from "../../db/pool";
import { awardBadges, BADGES, computeStreaks, headlineFor, listBadges, perfectWeeks } from "./engagement.service";

export const engagementRouter = Router();
engagementRouter.use(requireAuth);

engagementRouter.get("/overview", async (request, response) => {
  const period = currentPeriod();
  const records = await getCachedAttendance(request.session!.enrollmentId, period.year, period.month, 15);
  const summary = summarize(records);
  const rank = await pool.query<{ rank: number }>("SELECT rank FROM rank_snapshots WHERE enrollment_id = $1 AND month = $2", [request.session!.enrollmentId, `${period.year}-${period.month}`]);
  const user = await pool.query<{ id: number; created_at: Date }>("SELECT id, created_at FROM users WHERE id = $1", [request.session!.userId]);
  const streak = computeStreaks(records);
  const weeks = perfectWeeks(records);
  const totalStudents = await pool.query<{ count: string }>("SELECT count(*) FROM users WHERE active = TRUE");
  const freshBadges = user.rows[0] ? await awardBadges(request.session!.userId, { bestStreak: streak.best, currentStreak: streak.current, perfectWeeks: weeks, totalPresents: summary.present, totalAbsents: summary.absent, rank: rank.rows[0]?.rank ?? null }) : [];
  const ownedBadges = await listBadges(request.session!.userId);
  const joinedAt = user.rows[0]?.created_at ? new Date(user.rows[0].created_at).getTime() : 0;
  const friends = await pool.query<{ count: string }>("SELECT count(*) FROM friendships WHERE (user_id = $1 OR friend_user_id = $1) AND status = 'accepted'", [request.session!.userId]);
  return response.json({ month: period.month, year: period.year, ...summary, streak, perfectWeeks: weeks, rank: rank.rows[0]?.rank ?? null, totalStudents: Number(totalStudents.rows[0]?.count ?? 0), badges: BADGES.map((badge) => ({ ...badge, owned: ownedBadges.includes(badge.id), isNew: freshBadges.includes(badge.id) })), headline: headlineFor(summary.pct, summary.total), joinedRecently: Date.now() - joinedAt < 7 * 24 * 60 * 60 * 1000, friendsCount: Number(friends.rows[0]?.count ?? 0), checksText: "Mon–Sat, 9:15 AM – 4:45 PM IST (checked after every class)" });
});

engagementRouter.get("/yearly", async (request, response) => {
  const now = new Date();
  const year = Number(request.query.year ?? now.getFullYear());
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const max = year === now.getFullYear() ? now.getMonth() + 1 : 12;
  const monthRows = [];
  for (const month of months.slice(0, max)) {
    const summary = summarize(await getCachedAttendance(request.session!.enrollmentId, year, month));
    monthRows.push({ month, ...summary, hasData: summary.total > 0 });
  }
  const total = monthRows.reduce((sum, row) => sum + row.total, 0);
  const present = monthRows.reduce((sum, row) => sum + row.present, 0);
  const absent = monthRows.reduce((sum, row) => sum + row.absent, 0);
  return response.json({ year, overall: { total, present, absent, pct: total ? Math.round((present / total) * 100) : 0, monthsCount: monthRows.filter((row) => row.total).length }, months: monthRows });
});
