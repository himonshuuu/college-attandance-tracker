import { pool } from "../../db/pool";
import type { AttendanceRecord } from "../college/attendance.parser";

export interface BadgeDefinition { id: string; name: string; desc: string; icon: string }
export const BADGES: BadgeDefinition[] = [
  { id: "streak_5", name: "5-Class Streak", desc: "Attended 5 classes in a row", icon: "🔥" },
  { id: "streak_10", name: "10-Class Streak", desc: "Attended 10 classes in a row", icon: "⚡" },
  { id: "perfect_week", name: "Perfect Week", desc: "Zero absents in a full week", icon: "💯" },
  { id: "comeback", name: "Comeback Kid", desc: "Rebuilt a 3+ streak after an absent", icon: "🚀" },
  { id: "century", name: "Century", desc: "100 total presents recorded", icon: "💪" },
  { id: "top_3", name: "Top 3 Finish", desc: "Ranked in the leaderboard top 3", icon: "🏆" },
];

export function computeStreaks(records: AttendanceRecord[]): { current: number; best: number } {
  const sorted = [...records].filter((record) => record.status === "Present" || record.status === "Absent").sort((a, b) => `${a.date}${a.startTime ?? ""}`.localeCompare(`${b.date}${b.startTime ?? ""}`));
  let current = 0;
  let best = 0;
  for (const record of sorted) {
    if (record.status === "Present") { current++; best = Math.max(best, current); }
    else current = 0;
  }
  return { current, best };
}

export function perfectWeeks(records: AttendanceRecord[]): number {
  const weeks = new Map<string, { total: number; absent: number }>();
  for (const record of records) {
    if (record.status !== "Present" && record.status !== "Absent") continue;
    const date = new Date(`${record.date}T00:00:00Z`);
    const mondayOffset = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - mondayOffset);
    const key = date.toISOString().slice(0, 10);
    const week = weeks.get(key) ?? { total: 0, absent: 0 };
    week.total++;
    if (record.status === "Absent") week.absent++;
    weeks.set(key, week);
  }
  return [...weeks.values()].filter((week) => week.total > 0 && week.absent === 0).length;
}

export function headlineFor(pct: number, total: number, target = 75): string {
  if (total === 0) return "No classes recorded yet — check back after your first class today.";
  if (pct >= target) return `Strong start! You're at ${pct}% — above your ${target}% target. Keep the streak alive.`;
  if (pct >= target - 15) return `You're at ${pct}% — just below your ${target}% target. Every upcoming class counts.`;
  return `You're at ${pct}% — time for a comeback. Attend every class this week to climb back.`;
}

export async function awardBadges(userId: number, input: { bestStreak: number; currentStreak: number; perfectWeeks: number; totalPresents: number; totalAbsents: number; rank: number | null }): Promise<string[]> {
  const earned: string[] = [];
  if (input.bestStreak >= 5) earned.push("streak_5");
  if (input.bestStreak >= 10) earned.push("streak_10");
  if (input.perfectWeeks >= 1) earned.push("perfect_week");
  if (input.currentStreak >= 3 && input.totalAbsents > 0 && input.bestStreak >= 5) earned.push("comeback");
  if (input.totalPresents >= 100) earned.push("century");
  if (input.rank != null && input.rank >= 1 && input.rank <= 3) earned.push("top_3");
  if (!earned.length) return [];
  const existing = await pool.query<{ badge: string }>("SELECT badge FROM user_badges WHERE user_id = $1", [userId]);
  const owned = new Set(existing.rows.map((row) => row.badge));
  const fresh = earned.filter((badge) => !owned.has(badge));
  for (const badge of fresh) await pool.query("INSERT INTO user_badges (user_id, badge) VALUES ($1, $2) ON CONFLICT DO NOTHING", [userId, badge]);
  return fresh;
}

export async function listBadges(userId: number): Promise<string[]> {
  const result = await pool.query<{ badge: string }>("SELECT badge FROM user_badges WHERE user_id = $1", [userId]);
  return result.rows.map((row) => row.badge);
}
