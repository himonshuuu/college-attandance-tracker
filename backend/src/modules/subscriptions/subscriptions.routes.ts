import { Router, type Request, type Response } from "express";
import { pool } from "../../db/pool";
import { requireAuth } from "../auth/session";
import { env } from "../../config/env";
import { log } from "../../observability/logger";
import { sendTestNotification } from "../notifications/notification.service";

export const subscriptionsRouter = Router();
subscriptionsRouter.use(requireAuth);

subscriptionsRouter.get("/", async (request, response) => {
  const result = await pool.query<{ method: string; email: string | null }>("SELECT method, email FROM subscriptions WHERE enrollment_id = $1", [request.session!.enrollmentId]);
  const methods = result.rows.map((row) => row.method);
  const email = result.rows.find((row) => row.method === "email")?.email ?? request.session!.email;
  return response.json({ methods, email, hasBrowser: methods.includes("browser"), hasEmail: methods.includes("email"), hasMonthlyReport: methods.includes("monthly_report"), vapidKey: env.FIREBASE_VAPID_KEY });
});

async function saveSubscriptions(request: Request, response: Response): Promise<Response> {
  const raw = request.body as Record<string, unknown>;
  const requestedMethods = Array.isArray(raw.methods) ? raw.methods.map(String) : typeof raw.methods === "string" ? [raw.methods] : [
    ...(raw.method_email ? ["email"] : []),
    ...(raw.method_browser || raw.method_firebase ? ["browser"] : []),
    ...(raw.method_monthly_report ? ["monthly_report"] : []),
  ];
  const methods = [...new Set(requestedMethods.map((method) => method === "firebase" ? "browser" : method).filter((method): method is "browser" | "email" | "monthly_report" => method === "browser" || method === "email" || method === "monthly_report"))];
  const pushSubscription = raw.pushSubscription == null || raw.pushSubscription === "" ? null : typeof raw.pushSubscription === "string" ? raw.pushSubscription : raw.pushSubscription;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM subscriptions WHERE enrollment_id = $1", [request.session!.enrollmentId]);
    for (const method of methods) {
      await client.query(
        `INSERT INTO subscriptions (enrollment_id, method, email, push_subscription)
         VALUES ($1, $2, $3, $4)`,
        [request.session!.enrollmentId, method, method === "email" || method === "monthly_report" ? request.session!.email : null, method === "browser" && pushSubscription ? typeof pushSubscription === "string" ? pushSubscription : JSON.stringify(pushSubscription) : null],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  void sendTestNotification(request.session!.enrollmentId).catch((error) => {
    log("warn", "notification-test-failed", { error: error instanceof Error ? error.message : String(error) });
  });
  const message = methods.length ? `Saved! Subscribed to ${methods.map((method) => method === "browser" ? "Browser Push" : method === "monthly_report" ? "Monthly Report" : "Email").join(" and ")}.` : "Unsubscribed from all alerts.";
  if (request.is("application/x-www-form-urlencoded") || request.is("multipart/form-data")) {
    response.redirect("/subscribe?saved=1");
    return response;
  }
  return response.json({ success: true, message });
}

subscriptionsRouter.post("/", saveSubscriptions);
subscriptionsRouter.put("/", saveSubscriptions);
