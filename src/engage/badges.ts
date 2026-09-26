import type { Env } from "../types";

export interface BadgeDef {
  id: string;
  name: string;
  desc: string;
  icon: string;
}

export const BADGES: BadgeDef[] = [
  { id: "streak_5", name: "5-Class Streak", desc: "Attended 5 classes in a row", icon: "🔥" },
  { id: "streak_10", name: "10-Class Streak", desc: "Attended 10 classes in a row", icon: "⚡" },
  { id: "perfect_week", name: "Perfect Week", desc: "Zero absents in a full week", icon: "💯" },
  { id: "comeback", name: "Comeback Kid", desc: "Rebuilt a 3+ streak after an absent", icon: "🚀" },
  { id: "century", name: "Century", desc: "100 total presents recorded", icon: "💪" },
  { id: "top_3", name: "Top 3 Finish", desc: "Ranked in the leaderboard top 3", icon: "🏆" },
];

export interface BadgeInput {
  bestStreak: number;
  currentStreak: number;
  perfectWeeks: number;
  totalPresents: number;
  totalAbsents: number;
  rank?: number | null;
}

export function badgesEarned(input: BadgeInput): string[] {
  const earned: string[] = [];
  if (input.bestStreak >= 5) earned.push("streak_5");
  if (input.bestStreak >= 10) earned.push("streak_10");
  if (input.perfectWeeks >= 1) earned.push("perfect_week");
  if (input.currentStreak >= 3 && input.totalAbsents > 0 && input.bestStreak >= 5) earned.push("comeback");
  if (input.totalPresents >= 100) earned.push("century");
  if (input.rank != null && input.rank >= 1 && input.rank <= 3) earned.push("top_3");
  return earned;
}

/** Idempotently awards badges; returns the ids that are newly awarded. */
export async function awardBadges(env: Env, userId: number, input: BadgeInput): Promise<string[]> {
  const earned = badgesEarned(input);
  if (earned.length === 0) return [];
  const existing = await env.DB.prepare(`SELECT badge FROM user_badges WHERE user_id = ?`)
    .bind(userId).all<{ badge: string }>().catch(() => ({ results: [] as { badge: string }[] }));
  const owned = new Set(existing.results.map((r) => r.badge));
  const fresh = earned.filter((b) => !owned.has(b));
  for (const badge of fresh) {
    await env.DB.prepare(`INSERT OR IGNORE INTO user_badges (user_id, badge) VALUES (?, ?)`)
      .bind(userId, badge).run().catch(() => {});
  }
  return fresh;
}

export async function listBadges(env: Env, userId: number): Promise<string[]> {
  const rows = await env.DB.prepare(`SELECT badge FROM user_badges WHERE user_id = ?`)
    .bind(userId).all<{ badge: string }>().catch(() => ({ results: [] as { badge: string }[] }));
  return rows.results.map((r) => r.badge);
}
