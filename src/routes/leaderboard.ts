import { Hono } from "hono";
import type { HonoEnv } from "../middleware/auth";
import { fetchAttendance } from "../college/api";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

export const leaderboardRouter = new Hono<HonoEnv>();

leaderboardRouter.get("/", async (c) => {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const monthName = MONTHS[month - 1];

  let students;
  try {
    const result = await c.env.DB.prepare(
      `SELECT id, name, enrollment_id FROM users WHERE active = 1 ORDER BY name`
    ).all<{ id: number; name: string; enrollment_id: string }>();
    students = result.results;
  } catch {
    return c.json({ error: "Could not read students" }, 500);
  }

  if (students.length === 0) return c.json({ students: [], month: monthName, year });

  const entries = await Promise.all(
    students.map(async (s) => {
      try {
        const records = await fetchAttendance(c.env, s.enrollment_id, year, monthName);
        const total = records.length;
        const present = records.filter(r => r.status === "Present").length;
        const absent = records.filter(r => r.status === "Absent").length;
        const pct = total > 0 ? Math.round((present / total) * 100) : 0;
        return { name: s.name, enrollmentId: s.enrollment_id, total, present, absent, pct };
      } catch {
        return { name: s.name, enrollmentId: s.enrollment_id, total: 0, present: 0, absent: 0, pct: 0 };
      }
    })
  );

  entries.sort((a, b) => b.pct - a.pct || a.name.localeCompare(b.name));

  return c.json({ students: entries, month: monthName, year, totalStudents: entries.length });
});
