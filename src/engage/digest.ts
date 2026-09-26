import { fetchAttendance } from "../college/api";
import type { Env } from "../types";
import { emailCard, escapeHtml, sendEmail } from "../notify/notify";
import { awardBadges, BADGES } from "./badges";
import { computeMonthRanks } from "./ranks";
import { appUrl, computeStreaks, perfectWeeks } from "./stats";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

/**
 * Weekly digest (runs on a Monday cron): one summary email per active user
 * with month stats, rank movement, streak and new badges.
 */
export async function runWeeklyDigest(env: Env): Promise<{ sent: number; errors: number }> {
  const now = new Date();
  const monthName = MONTHS[now.getMonth()];
  const year = now.getFullYear();

  const ranks = await computeMonthRanks(env);
  const byEnrollment = new Map(ranks.map((r) => [r.enrollmentId, r]));
  const origin = appUrl(env);

  const users = await env.DB.prepare(
    `SELECT id, name, enrollment_id, email FROM users WHERE active = 1`
  ).all<{ id: number; name: string; enrollment_id: string; email: string }>()
    .catch(() => ({ results: [] as { id: number; name: string; enrollment_id: string; email: string }[] }));

  let sent = 0;
  let errors = 0;

  for (const u of users.results) {
    if (!u.email) continue;
    try {
      const records = await fetchAttendance(env, u.enrollment_id, year, monthName).catch(() => []);
      const total = records.length;
      const present = records.filter((r) => r.status === "Present").length;
      const absent = records.filter((r) => r.status === "Absent").length;
      const pct = total > 0 ? Math.round((present / total) * 100) : 0;
      const streak = computeStreaks(records);
      const weeks = perfectWeeks(records);
      const rank = byEnrollment.get(u.enrollment_id);

      const fresh = await awardBadges(env, u.id, {
        bestStreak: streak.best,
        currentStreak: streak.current,
        perfectWeeks: weeks,
        totalPresents: present,
        totalAbsents: absent,
        rank: rank && rank.total > 0 ? rank.rank : null,
      });

      const badgeNames = fresh
        .map((id) => BADGES.find((b) => b.id === id))
        .filter((b) => !!b)
        .map((b) => `${b!.icon} ${b!.name}`)
        .join(", ");

      const firstName = escapeHtml((u.name || "there").split(" ")[0]);
      const rankLine = rank && rank.total > 0
        ? `<strong>#${rank.rank} of ${ranks.length}</strong> on the ${monthName} leaderboard`
        : "no classes recorded yet this month";

      await sendEmail(
        env,
        u.email,
        `Your weekly attendance digest — ${pct}% in ${monthName}`,
        `Hi ${u.name},\n\nYour week in attendance (${monthName}): ${pct}% (${present}/${total} classes), rank ${rank ? `#${rank.rank} of ${ranks.length}` : "—"}, current streak ${streak.current}.\n${badgeNames ? `New badges: ${badgeNames}\n` : ""}\nOpen the app: ${origin}\n\n— Attendance Monitor`,
        emailCard({
          heading: `Your week: ${pct}% ${streak.current >= 3 ? "🔥" : ""}`,
          introHtml: `Hi ${firstName}, here's your ${monthName} summary: <strong>${pct}%</strong> (${present}/${total} classes), ranked ${rankLine}, on a <strong>${streak.current}-class streak</strong>.`,
          button: { label: "Open Attendance Monitor", url: origin },
          bodyHtml:
            `<table style="width:100%;border-collapse:collapse;margin-top:4px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;font-size:13px;">` +
            `<tr><td style="padding:8px 12px;color:#64748b;">Present</td><td style="padding:8px 12px;color:#16a34a;font-weight:700;">${present}</td></tr>` +
            `<tr><td style="padding:8px 12px;color:#64748b;">Absent</td><td style="padding:8px 12px;color:#dc2626;font-weight:700;">${absent}</td></tr>` +
            `<tr><td style="padding:8px 12px;color:#64748b;">Best streak</td><td style="padding:8px 12px;color:#0f172a;font-weight:700;">${streak.best} classes</td></tr>` +
            `<tr><td style="padding:8px 12px;color:#64748b;">Perfect weeks</td><td style="padding:8px 12px;color:#0f172a;font-weight:700;">${weeks}</td></tr>` +
            `</table>` +
            (badgeNames ? `<p style="margin:12px 0 0;font-size:13px;color:#0f172a;">🏅 New badge${fresh.length > 1 ? "s" : ""}: <strong>${escapeHtml(badgeNames)}</strong></p>` : ""),
          footerHtml: `Weekly digest • ${monthName} ${year} • Attendance Monitor`,
        }),
      );
      sent++;
    } catch (err) {
      errors++;
      console.error(JSON.stringify({ event: "digest-user-failed", error: String(err) }));
    }
  }

  console.log(JSON.stringify({ event: "weekly-digest-done", sent, errors }));
  return { sent, errors };
}
