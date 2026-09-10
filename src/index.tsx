import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { sessionMiddleware, type HonoEnv } from "./middleware/auth";

import { authRouter } from "./routes/auth";
import { analyticsRouter } from "./routes/analytics";
import { leaderboardRouter } from "./routes/leaderboard";
import { profileRouter } from "./routes/profile";
import { subscribeRouter } from "./routes/subscribe";
import { adminRouter } from "./routes/admin";

import { runMonitorCycle } from "./monitor/monitor";

const app = new Hono<HonoEnv>();

app.use("*", logger());
app.use("*", cors({ origin: "*", allowMethods: ["GET", "POST", "OPTIONS"] }));
app.use("*", sessionMiddleware);

app.get("/sw.js", (c) => c.redirect("/firebase-messaging-sw.js"));

app.route("/api/auth", authRouter);
app.route("/api/analytics", analyticsRouter);
app.route("/api/leaderboard", leaderboardRouter);
app.route("/api/profile", profileRouter);
app.route("/api/subscribe", subscribeRouter);
app.route("/api/admin", adminRouter);

app.get("/api/debug/push", async (c) => {
  const eid = c.req.query("eid");
  if (!eid) return c.json({ error: "Add ?eid=ENROLLMENT_ID" }, 400);
  const { getSubscriptions } = await import("./notify/notify");
  const subs = await getSubscriptions(c.env, eid);
  return c.json({ eid, subCount: subs.length, subscriptions: subs });
});

export default {
  fetch: app.fetch,

  async scheduled(_event: unknown, env: HonoEnv["Bindings"], context: { waitUntil: (p: Promise<unknown>) => void }) {
    context.waitUntil(
      runMonitorCycle(env).catch((err) => {
        console.error(JSON.stringify({ event: "scheduled-cycle-error", error: String(err) }));
      })
    );
  },
};
