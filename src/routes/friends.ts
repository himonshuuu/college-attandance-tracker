import { Hono } from "hono";
import { requireAuth, type HonoEnv } from "../middleware/auth";
import { fetchAttendance } from "../college/api";
import { currentMonth } from "../engage/ranks";

export const friendsRouter = new Hono<HonoEnv>();

friendsRouter.use("*", requireAuth);

const MAX_FRIENDS = 5;

interface FriendUser {
  id: number;
  name: string;
  enrollment_id: string;
  email: string;
}

async function myUserId(c: { env: HonoEnv["Bindings"]; get: (k: "session") => { userId: number } | undefined }): Promise<number | null> {
  const session = c.get("session");
  return session ? session.userId : null;
}

async function monthPct(env: HonoEnv["Bindings"], enrollmentId: string): Promise<{ pct: number; total: number; present: number; absent: number }> {
  const { year, monthName } = currentMonth();
  try {
    const records = await fetchAttendance(env, enrollmentId, year, monthName);
    const total = records.length;
    const present = records.filter((r) => r.status === "Present").length;
    const absent = records.filter((r) => r.status === "Absent").length;
    return { pct: total > 0 ? Math.round((present / total) * 100) : 0, total, present, absent };
  } catch {
    return { pct: 0, total: 0, present: 0, absent: 0 };
  }
}

/** List accepted friends + pending incoming/outgoing requests. */
friendsRouter.get("/", async (c) => {
  const userId = await myUserId(c);
  if (!userId) return c.json({ error: "Unauthorized" }, 401);

  const rows = await c.env.DB.prepare(
    `SELECT f.id, f.user_id, f.friend_user_id, f.status,
            u1.name AS from_name, u1.enrollment_id AS from_eid,
            u2.name AS to_name, u2.enrollment_id AS to_eid
     FROM friendships f
     JOIN users u1 ON u1.id = f.user_id
     JOIN users u2 ON u2.id = f.friend_user_id
     WHERE f.user_id = ? OR f.friend_user_id = ?`
  ).bind(userId, userId).all<{
    id: number; user_id: number; friend_user_id: number; status: string;
    from_name: string; from_eid: string; to_name: string; to_eid: string;
  }>().catch(() => ({ results: [] as never[] }));

  const friends: Array<{ id: number; userId: number; name: string; enrollmentId: string; pct: number; total: number }> = [];
  const incoming: Array<{ id: number; userId: number; name: string; enrollmentId: string }> = [];
  const outgoing: Array<{ id: number; userId: number; name: string; enrollmentId: string }> = [];

  for (const r of rows.results) {
    const otherId = r.user_id === userId ? r.friend_user_id : r.user_id;
    const otherName = r.user_id === userId ? r.to_name : r.from_name;
    const otherEid = r.user_id === userId ? r.to_eid : r.from_eid;
    if (r.status === "accepted") {
      const s = await monthPct(c.env, otherEid);
      friends.push({ id: r.id, userId: otherId, name: otherName, enrollmentId: otherEid, pct: s.pct, total: s.total });
    } else if (r.friend_user_id === userId) {
      incoming.push({ id: r.id, userId: otherId, name: otherName, enrollmentId: otherEid });
    } else {
      outgoing.push({ id: r.id, userId: otherId, name: otherName, enrollmentId: otherEid });
    }
  }

  return c.json({ friends, incoming, outgoing, maxFriends: MAX_FRIENDS });
});

/** Send a friend request by email or enrollment ID. */
friendsRouter.post("/", async (c) => {
  const userId = await myUserId(c);
  if (!userId) return c.json({ error: "Unauthorized" }, 401);

  let query = "";
  try {
    const body = (await c.req.json()) as Record<string, unknown>;
    query = String(body.email || body.enrollmentId || body.query || "").trim().toLowerCase();
  } catch {
    return c.json({ success: false, error: "Invalid request." }, 400);
  }
  if (!query) return c.json({ success: false, error: "Email or enrollment ID required." }, 400);

  const target = await c.env.DB.prepare(
    `SELECT id, name, enrollment_id, email FROM users WHERE lower(email) = ? OR lower(enrollment_id) = ?`
  ).bind(query, query).first<FriendUser>();
  if (!target) return c.json({ success: false, error: "No student found with that email or enrollment ID." }, 404);
  if (target.id === userId) return c.json({ success: false, error: "You can't add yourself." }, 400);

  const existing = await c.env.DB.prepare(
    `SELECT id, user_id, friend_user_id, status FROM friendships
     WHERE (user_id = ? AND friend_user_id = ?) OR (user_id = ? AND friend_user_id = ?)`
  ).bind(userId, target.id, target.id, userId)
    .first<{ id: number; user_id: number; friend_user_id: number; status: string }>().catch(() => null);

  if (existing) {
    if (existing.status === "accepted") return c.json({ success: false, error: "You're already friends." }, 409);
    // They already requested me — accept theirs.
    if (existing.friend_user_id === userId) {
      await c.env.DB.prepare(`UPDATE friendships SET status = 'accepted' WHERE id = ?`).bind(existing.id).run();
      return c.json({ success: true, message: `You're now friends with ${target.name}!` });
    }
    return c.json({ success: false, error: "Request already sent." }, 409);
  }

  const count = await c.env.DB.prepare(
    `SELECT COUNT(*) as n FROM friendships WHERE (user_id = ? OR friend_user_id = ?) AND status = 'accepted'`
  ).bind(userId, userId).first<{ n: number }>().catch(() => ({ n: 0 }));
  if ((count?.n ?? 0) >= MAX_FRIENDS) {
    return c.json({ success: false, error: `You can have up to ${MAX_FRIENDS} friends.` }, 400);
  }

  await c.env.DB.prepare(`INSERT INTO friendships (user_id, friend_user_id, status) VALUES (?, ?, 'pending')`)
    .bind(userId, target.id).run();
  return c.json({ success: true, message: `Friend request sent to ${target.name}!` });
});

friendsRouter.post("/:id/accept", async (c) => {
  const userId = await myUserId(c);
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  const id = Number(c.req.param("id"));
  const row = await c.env.DB.prepare(`SELECT friend_user_id, status FROM friendships WHERE id = ?`)
    .bind(id).first<{ friend_user_id: number; status: string }>().catch(() => null);
  if (!row || row.friend_user_id !== userId || row.status !== "pending") {
    return c.json({ success: false, error: "Request not found." }, 404);
  }
  await c.env.DB.prepare(`UPDATE friendships SET status = 'accepted' WHERE id = ?`).bind(id).run();
  return c.json({ success: true });
});

friendsRouter.post("/:id/decline", async (c) => {
  const userId = await myUserId(c);
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  const id = Number(c.req.param("id"));
  const row = await c.env.DB.prepare(`SELECT friend_user_id, status FROM friendships WHERE id = ?`)
    .bind(id).first<{ friend_user_id: number; status: string }>().catch(() => null);
  if (!row || row.friend_user_id !== userId || row.status !== "pending") {
    return c.json({ success: false, error: "Request not found." }, 404);
  }
  await c.env.DB.prepare(`DELETE FROM friendships WHERE id = ?`).bind(id).run();
  return c.json({ success: true });
});

friendsRouter.delete("/:id", async (c) => {
  const userId = await myUserId(c);
  if (!userId) return c.json({ error: "Unauthorized" }, 401);
  const id = Number(c.req.param("id"));
  await c.env.DB.prepare(`DELETE FROM friendships WHERE id = ? AND (user_id = ? OR friend_user_id = ?)`)
    .bind(id, userId, userId).run();
  return c.json({ success: true });
});

/** Side-by-side comparison with an accepted friend (this month). */
friendsRouter.get("/compare/:friendUserId", async (c) => {
  const session = c.get("session");
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  const friendUserId = Number(c.req.param("friendUserId"));

  const rel = await c.env.DB.prepare(
    `SELECT id FROM friendships WHERE status = 'accepted' AND
     ((user_id = ? AND friend_user_id = ?) OR (user_id = ? AND friend_user_id = ?))`
  ).bind(session.userId, friendUserId, friendUserId, session.userId)
    .first<{ id: number }>().catch(() => null);
  if (!rel) return c.json({ error: "You're not friends with this student." }, 403);

  const friend = await c.env.DB.prepare(`SELECT name, enrollment_id FROM users WHERE id = ?`)
    .bind(friendUserId).first<{ name: string; enrollment_id: string }>();
  if (!friend) return c.json({ error: "Student not found." }, 404);

  const { year, monthName } = currentMonth();
  const [meRecords, frRecords] = await Promise.all([
    fetchAttendance(c.env, session.enrollmentId, year, monthName).catch(() => []),
    fetchAttendance(c.env, friend.enrollment_id, year, monthName).catch(() => []),
  ]);

  const summarize = (records: typeof meRecords) => {
    const total = records.length;
    const present = records.filter((r) => r.status === "Present").length;
    const map: Record<string, { p: number; t: number }> = {};
    for (const r of records) {
      const k = r.subject || "Unknown";
      map[k] = map[k] || { p: 0, t: 0 };
      map[k].t++;
      if (r.status === "Present") map[k].p++;
    }
    const subjects = Object.entries(map).map(([name, d]) => ({
      name, pct: d.t > 0 ? Math.round((d.p / d.t) * 100) : 0,
    }));
    return { total, present, pct: total > 0 ? Math.round((present / total) * 100) : 0, subjects };
  };

  const me = summarize(meRecords);
  const fr = summarize(frRecords);
  const frMap = new Map(fr.subjects.map((s) => [s.name, s.pct]));
  const names = [...new Set([...me.subjects.map((s) => s.name), ...fr.subjects.map((s) => s.name)])].sort();
  const subjects = names.map((name) => {
    const mePct = me.subjects.find((s) => s.name === name)?.pct ?? null;
    const frPct = frMap.get(name) ?? null;
    return { name, mePct, friendPct: frPct, delta: mePct != null && frPct != null ? mePct - frPct : null };
  });

  return c.json({
    month: monthName,
    year,
    me: { name: "You", ...me },
    friend: { name: friend.name, ...fr },
    subjects,
  });
});
