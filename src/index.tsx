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
import { runCacheWarm } from "./engage/warm";

const WEEKLY_DIGEST_CRON = "30 1 * * 1"; // Monday 07:00 IST
const NIGHTLY_WARM_CRON = "0 21 * * *"; // Daily 02:30 IST — portal is idle

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

// App paths (client-side router): serve the SPA shell so deep links,
// refreshes and shared URLs work. Real data still comes from /api/*.
// NOTE: the shell is inlined because subrequests from inside a Worker go
// straight back to the Worker (bypassing static assets). Keep this in sync
// with public/index.html (built output) if that file's structure changes.
const APP_SHELL = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Attendance Monitor</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js"></script>
    <script src="https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js"></script>
    <link rel="stylesheet" href="/styles.css" />
    <script type="module" crossorigin src="/assets/index.js"></script>
  </head>
  <body class="bg-slate-50 text-slate-900 min-h-screen p-4 sm:p-6 pb-24">
    <div id="root"></div>
  </body>
</html>`;

for (const path of APP_PATHS) {
  app.get(path, (c) => {
    return c.html(APP_SHELL);
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
    if (event.cron === NIGHTLY_WARM_CRON) {
      context.waitUntil(
        runCacheWarm(env).catch((err) => {
          console.error(JSON.stringify({ event: "cache-warm-error", error: String(err) }));
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
