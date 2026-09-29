import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool";
import { requireAuth } from "../auth/session";

export const subscriptionsRouter = Router();
subscriptionsRouter.use(requireAuth);

subscriptionsRouter.get("/", async (request, response) => {
  const result = await pool.query<{ method: string; email: string | null }>("SELECT method, email FROM subscriptions WHERE enrollment_id = $1", [request.session!.enrollmentId]);
  const methods = result.rows.map((row) => row.method);
  const email = result.rows.find((row) => row.method === "email")?.email ?? request.session!.email;
  return response.json({ methods, email, hasBrowser: methods.includes("browser"), hasEmail: methods.includes("email"), hasMonthlyReport: methods.includes("monthly_report") });
});

subscriptionsRouter.put("/", async (request, response) => {
  const body = z.object({ methods: z.array(z.enum(["browser", "email", "monthly_report"])).default([]), pushSubscription: z.union([z.string(), z.record(z.unknown())]).nullable().optional() }).parse(request.body);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM subscriptions WHERE enrollment_id = $1", [request.session!.enrollmentId]);
    for (const method of [...new Set(body.methods)]) {
      await client.query(
        `INSERT INTO subscriptions (enrollment_id, method, email, push_subscription)
         VALUES ($1, $2, $3, $4)`,
        [request.session!.enrollmentId, method, method === "email" || method === "monthly_report" ? request.session!.email : null, method === "browser" && body.pushSubscription ? JSON.stringify(body.pushSubscription) : null],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return response.json({ success: true, message: body.methods.length ? "Subscriptions saved." : "Unsubscribed from all alerts." });
});
