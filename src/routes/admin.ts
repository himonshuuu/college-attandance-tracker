import { Hono } from "hono";
import type { HonoEnv } from "../middleware/auth";
import { sendTestNotification } from "../notify/notify";

interface SubRow {
  id: number;
  enrollment_id: string;
  method: string;
  email: string | null;
  push_subscription: string | null;
  created_at: string;
  user_name: string | null;
  user_email: string | null;
}

export const adminRouter = new Hono<HonoEnv>();

adminRouter.get("/subscriptions", async (c) => {
  const result = await c.env.DB.prepare(
    `SELECT s.id, s.enrollment_id, s.method, s.email, s.push_subscription, s.created_at,
            u.name as user_name, u.email as user_email
     FROM subscriptions s
     LEFT JOIN users u ON u.enrollment_id = s.enrollment_id
     ORDER BY s.created_at DESC`
  ).all<SubRow>();

  const subs = result.results.map(r => ({
    id: r.id,
    enrollmentId: r.enrollment_id,
    name: r.user_name || "—",
    email: r.user_email || "—",
    method: r.method,
    notifyEmail: r.email,
    hasPush: !!r.push_subscription,
    subscribedAt: r.created_at,
  }));

  return c.json({ total: subs.length, subscriptions: subs });
});

adminRouter.post("/subscriptions", async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const enrollmentId = body.enrollmentId ? String(body.enrollmentId).trim() : null;

  if (enrollmentId) {
    const result = await sendTestNotification(c.env, enrollmentId);
    return c.json({ success: true, sent: result, enrollmentId });
  }

  const all = await c.env.DB.prepare(`SELECT DISTINCT enrollment_id FROM subscriptions`).all<{ enrollment_id: string }>();
  const results: Record<string, unknown> = {};
  for (const row of all.results) {
    try {
      results[row.enrollment_id] = await sendTestNotification(c.env, row.enrollment_id);
    } catch {
      results[row.enrollment_id] = {};
    }
  }
  return c.json({ success: true, sent: results, count: all.results.length });
});
