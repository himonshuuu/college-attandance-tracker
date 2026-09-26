import type { AttendanceRecord } from "../types";

/** When attendance checks run — shown in empty states and digests. */
export const CHECKS_TEXT = "Mon–Sat, 9:15 AM – 4:45 PM IST (checked after every class)";

export const APP_URL_FALLBACK = "https://college-attendance-monitor.saikiahimangshu1256.workers.dev";

export function appUrl(env: { APP_URL?: string }): string {
  const configured = (env.APP_URL || "").trim().replace(/\/+$/, "");
  return configured || APP_URL_FALLBACK;
}

export function monthKey(year: number, monthName: string): string {
  return `${year}-${monthName}`;
}

export interface StreakInfo {
  current: number;
  best: number;
}

/** Records in chronological order (oldest first). */
export function sortRecords(records: AttendanceRecord[]): AttendanceRecord[] {
  return [...records].sort((a, b) =>
    (a.date + (a.startTime || "")).localeCompare(b.date + (b.startTime || ""))
  );
}

/** Current trailing run of Presents + longest run of Presents. */
export function computeStreaks(records: AttendanceRecord[]): StreakInfo {
  const sorted = sortRecords(records).filter((r) => r.status === "Present" || r.status === "Absent");
  let best = 0;
  let run = 0;
  for (const r of sorted) {
    if (r.status === "Present") {
      run++;
      if (run > best) best = run;
    } else {
      run = 0;
    }
  }
  return { current: run, best };
}

/** Streak of Presents excluding one specific class (used when that class just got marked). */
export function streakExcluding(
  records: AttendanceRecord[],
  exclude: { date: string; subject: string; startTime: string },
): number {
  const rest = sortRecords(records).filter(
    (r) =>
      (r.status === "Present" || r.status === "Absent") &&
      !(r.date === exclude.date && r.subject === exclude.subject && r.startTime === exclude.startTime),
  );
  let run = 0;
  for (let i = rest.length - 1; i >= 0; i--) {
    if (rest[i].status === "Present") run++;
    else break;
  }
  return run;
}

function isoWeekKey(dateStr: string): string {
  // dateStr: YYYY-MM-DD
  const d = new Date(dateStr + "T00:00:00Z");
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - day);
  return monday.toISOString().slice(0, 10);
}

/** Weeks (Mon–Sun) with at least one class and zero absents. */
export function perfectWeeks(records: AttendanceRecord[]): number {
  const weeks = new Map<string, { total: number; absent: number }>();
  for (const r of records) {
    if (r.status !== "Present" && r.status !== "Absent") continue;
    const key = isoWeekKey(r.date);
    const w = weeks.get(key) || { total: 0, absent: 0 };
    w.total++;
    if (r.status === "Absent") w.absent++;
    weeks.set(key, w);
  }
  let count = 0;
  for (const w of weeks.values()) {
    if (w.total > 0 && w.absent === 0) count++;
  }
  return count;
}

/** One-line insight shown right after registration and on the profile. */
export function headlineFor(pct: number, total: number, target = 75): string {
  if (total === 0) return "No classes recorded yet — check back after your first class today.";
  if (pct >= target) return `Strong start! You're at ${pct}% — above your ${target}% target. Keep the streak alive.`;
  if (pct >= target - 15) return `You're at ${pct}% — just below your ${target}% target. Every upcoming class counts.`;
  return `You're at ${pct}% — time for a comeback. Attend every class this week to climb back.`;
}
