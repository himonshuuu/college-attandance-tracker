import { Hono } from "hono";
import { requireAuth, type HonoEnv } from "../middleware/auth";
import { upsertStudent } from "../students";
import { sendTestNotification } from "../notify/notify";

export const subscribeRouter = new Hono<HonoEnv>();

subscribeRouter.use("*", requireAuth);

subscribeRouter.get("/", async (c) => {
  const session = c.get("session")!;
  const enrollmentId = session.enrollmentId;

  const result = await c.env.DB.prepare(
    `SELECT method, email FROM subscriptions WHERE enrollment_id = ?`
  ).bind(enrollmentId).all<{ method: string; email: string | null }>();

  const methods = result.results.map(r => r.method);
  const emailSub = result.results.find(r => r.method === "email");

  return c.json({
    methods,
    email: emailSub?.email || session.email,
    hasBrowser: methods.includes("browser") || methods.includes("firebase"),
    hasEmail: methods.includes("email"),
    vapidKey: c.env.FIREBASE_VAPID_KEY || "BH2Mc0SDTxo1LZnxF2FQL-p2TlBRX1nfG0HNOSG3H0Yx8qBb8ZwD40suAFcBCg_8ZO4dMzQjUcOmTft_oCXg3wA",
  });
});

subscribeRouter.post("/", async (c) => {
  const session = c.get("session")!;
  const enrollmentId = session.enrollmentId;
  const isForm = c.req.header("content-type")?.includes("application/x-www-form-urlencoded") || c.req.header("content-type")?.includes("multipart/form-data");

  let rawMethods: string[] = [];
  let pushSubscription: string | null = null;

  if (isForm) {
    const body = await c.req.parseBody();
    if (body.method_email) rawMethods.push("email");
    if (body.method_firebase || body.method_browser) rawMethods.push("browser");
    if (Array.isArray(body.methods)) rawMethods = body.methods.map(String);
    pushSubscription = body.pushSubscription ? String(body.pushSubscription) : null;
  } else {
    try {
      const body = (await c.req.json()) as Record<string, unknown>;
      if (Array.isArray(body.methods)) {
        rawMethods = body.methods.map(String).filter(m => ["browser", "firebase", "email"].includes(m));
      } else if (typeof body.method === "string" && ["browser", "firebase", "email"].includes(body.method)) {
        rawMethods = [body.method];
      }
      pushSubscription = body.pushSubscription ? (typeof body.pushSubscription === "string" ? body.pushSubscription : JSON.stringify(body.pushSubscription)) : null;
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }
  }

  // Normalize method names to database CHECK constraint values ('browser', 'email')
  const normalizedMethods = Array.from(
    new Set(rawMethods.map(m => (m === "firebase" || m === "browser" ? "browser" : "email")))
  );

  const email = session.email;

  const exists = await c.env.DB.prepare(`SELECT id FROM users WHERE enrollment_id = ?`)
    .bind(enrollmentId).first();
  if (!exists) {
    try {
      const { fetchStudentProfile } = await import("../college/api");
      const p = await fetchStudentProfile(c.env, enrollmentId);
      await upsertStudent(c.env, enrollmentId, p);
    } catch {
      if (isForm) return c.redirect("/subscribe?error=Could+not+verify+enrollment");
      return c.json({ error: "Could not verify enrollment ID." }, 400);
    }
  }

  await c.env.DB.prepare(`DELETE FROM subscriptions WHERE enrollment_id = ?`).bind(enrollmentId).run();

  for (const method of normalizedMethods) {
    const methodEmail = method === "email" ? email : null;
    const methodPush = method === "browser" ? pushSubscription : null;
    await c.env.DB.prepare(
      `INSERT INTO subscriptions (enrollment_id, method, email, push_subscription) VALUES (?, ?, ?, ?)`
    ).bind(enrollmentId, method, methodEmail, methodPush).run();
  }

  const labels = normalizedMethods.length > 0
    ? normalizedMethods.map(m => m === "browser" ? "Browser Push" : "Email").join(" and ")
    : "none";

  if (normalizedMethods.length > 0) {
    sendTestNotification(c.env, enrollmentId).catch((err) => {
      console.warn("sendTestNotification warning:", err);
    });
  }

  if (isForm) {
    return c.redirect("/subscribe?saved=1");
  }

  return c.json({
    success: true,
    message: normalizedMethods.length > 0 ? `Saved! Subscribed to ${labels}.` : "Unsubscribed from all alerts.",
  });
});
