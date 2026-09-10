import { Hono } from "hono";
import { requireAuth, type HonoEnv } from "../middleware/auth";
import { fetchAttendance, fetchStudentProfile } from "../college/api";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

export const analyticsRouter = new Hono<HonoEnv>();

analyticsRouter.use("*", requireAuth);

analyticsRouter.get("/", async (c) => {
  const session = c.get("session")!;
  const enrollmentId = session.enrollmentId;

  const now = new Date();
  const month = Number(c.req.query("month") ?? (now.getMonth() + 1));
  const year = Number(c.req.query("year") ?? now.getFullYear());
  const monthName = MONTHS[month - 1] ?? MONTHS[now.getMonth()];

  let profile, records;
  try {
    [profile, records] = await Promise.all([
      fetchStudentProfile(c.env, enrollmentId),
      fetchAttendance(c.env, enrollmentId, year, monthName),
    ]);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Failed to fetch data" }, 500);
  }

  const total = records.length;
  const present = records.filter(r => r.status === "Present").length;
  const absent = records.filter(r => r.status === "Absent").length;
  const pct = total > 0 ? Math.round((present / total) * 100) : 0;

  const subjectMap: Record<string, { p: number; a: number; t: number }> = {};
  for (const r of records) {
    const k = r.subject || "Unknown";
    if (!subjectMap[k]) subjectMap[k] = { p: 0, a: 0, t: 0 };
    subjectMap[k].t++;
    if (r.status === "Present") subjectMap[k].p++;
    else if (r.status === "Absent") subjectMap[k].a++;
  }
  const subjects = Object.entries(subjectMap)
    .map(([name, d]) => ({ name, present: d.p, absent: d.a, total: d.t, pct: d.t > 0 ? Math.round((d.p / d.t) * 100) : 0 }))
    .sort((a, b) => a.pct - b.pct);

  const dailyMap: Record<string, { p: number; a: number }> = {};
  for (const r of records) {
    if (!dailyMap[r.date]) dailyMap[r.date] = { p: 0, a: 0 };
    if (r.status === "Present") dailyMap[r.date].p++;
    else if (r.status === "Absent") dailyMap[r.date].a++;
  }
  const daily = Object.entries(dailyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => ({ date, present: d.p, absent: d.a, pct: d.p + d.a > 0 ? Math.round((d.p / (d.p + d.a)) * 100) : 0 }));

  return c.json({
    student: { name: profile.name, enrollmentId, className: profile.className, stream: profile.stream },
    month: monthName,
    year,
    total,
    present,
    absent,
    pct,
    subjects,
    daily,
    records,
  });
});
