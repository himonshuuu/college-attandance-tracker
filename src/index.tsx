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
import { engageRouter } from "./routes/engage";
import { friendsRouter } from "./routes/friends";

import { runMonitorCycle } from "./monitor/monitor";
import { maybeCheckRanksDaily } from "./engage/ranks";
import { runWeeklyDigest } from "./engage/digest";

const WEEKLY_DIGEST_CRON = "30 1 * * 1"; // Monday 07:00 IST

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
app.route("/api/engage", engageRouter);
app.route("/api/friends", friendsRouter);

// App paths (client-side router): serve the SPA shell so deep links,
// refreshes and shared URLs work. Real data still comes from /api/*.
const APP_PATHS = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/profile",
  "/analytics",
  "/leaderboard",
  "/subscribe",
  "/friends",
];

for (const path of APP_PATHS) {
  app.get(path, async (c) => {
    const url = new URL("/index.html", c.req.url);
    const asset = await c.env.ASSETS.fetch(new Request(url.toString(), c.req.raw));
    const headers = new Headers(asset.headers);
    headers.set("content-type", "text/html; charset=utf-8");
    return new Response(asset.body, { status: 200, headers });
  });
}

app.get("/api/debug/push", async (c) => {
  const eid = c.req.query("eid");
  if (!eid) return c.json({ error: "Add ?eid=ENROLLMENT_ID" }, 400);
  const { getSubscriptions } = await import("./notify/notify");
  const subs = await getSubscriptions(c.env, eid);
  return c.json({ eid, subCount: subs.length, subscriptions: subs });
});

export default {
  fetch: app.fetch,

  async scheduled(event: { cron: string }, env: HonoEnv["Bindings"], context: { waitUntil: (p: Promise<unknown>) => void }) {
    if (event.cron === WEEKLY_DIGEST_CRON) {
      context.waitUntil(
        runWeeklyDigest(env).catch((err) => {
          console.error(JSON.stringify({ event: "weekly-digest-error", error: String(err) }));
        })
      );
      return;
    }
    context.waitUntil(
      (async () => {
        await runMonitorCycle(env);
        await maybeCheckRanksDaily(env);
      })().catch((err) => {
        console.error(JSON.stringify({ event: "scheduled-cycle-error", error: String(err) }));
      })
    );
  },
};
