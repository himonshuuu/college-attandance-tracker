import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool";
import { requireAuth } from "../auth/session";
import { currentPeriod, getCachedAttendance, summarize } from "../attendance/attendance.service";

export const friendsRouter = Router();
friendsRouter.use(requireAuth);
const MAX_FRIENDS = 5;

friendsRouter.get("/", async (request, response) => {
  const result = await pool.query<{
    id: number; user_id: number; friend_user_id: number; status: string;
    from_name: string; from_eid: string; to_name: string; to_eid: string;
  }>(
    `SELECT f.id, f.user_id, f.friend_user_id, f.status,
            u1.name AS from_name, u1.enrollment_id AS from_eid,
            u2.name AS to_name, u2.enrollment_id AS to_eid
       FROM friendships f
       JOIN users u1 ON u1.id = f.user_id
       JOIN users u2 ON u2.id = f.friend_user_id
      WHERE f.user_id = $1 OR f.friend_user_id = $1`,
    [request.session!.userId],
  );
  const accepted = result.rows.filter((row) => row.status === "accepted");
  const friends = await Promise.all(accepted.map(async (row) => {
    const otherId = row.user_id === request.session!.userId ? row.friend_user_id : row.user_id;
    const enrollmentId = row.user_id === request.session!.userId ? row.to_eid : row.from_eid;
    const period = currentPeriod();
    const records = await getCachedAttendance(enrollmentId, period.year, period.month).catch(() => []);
    const summary = summarize(records);
    return { id: row.id, userId: otherId, name: row.user_id === request.session!.userId ? row.to_name : row.from_name, enrollmentId, pct: summary.pct, total: summary.total };
  }));
  const incoming = result.rows.filter((row) => row.status === "pending" && row.friend_user_id === request.session!.userId).map((row) => ({ id: row.id, userId: row.user_id, name: row.from_name, enrollmentId: row.from_eid }));
  const outgoing = result.rows.filter((row) => row.status === "pending" && row.user_id === request.session!.userId).map((row) => ({ id: row.id, userId: row.friend_user_id, name: row.to_name, enrollmentId: row.to_eid }));
  return response.json({ friends, incoming, outgoing, maxFriends: MAX_FRIENDS });
});

friendsRouter.post("/", async (request, response) => {
  const { query } = z.object({ query: z.string().trim().min(1) }).parse({ query: request.body.email ?? request.body.enrollmentId ?? request.body.query });
  const targetResult = await pool.query<{ id: number; name: string; enrollment_id: string }>("SELECT id, name, enrollment_id FROM users WHERE lower(email) = lower($1) OR lower(enrollment_id) = lower($1)", [query]);
  const target = targetResult.rows[0];
  if (!target) return response.status(404).json({ success: false, error: "No student found with that email or enrollment ID." });
  if (target.id === request.session!.userId) return response.status(400).json({ success: false, error: "You can't add yourself." });
  const existing = await pool.query<{ id: number; user_id: number; friend_user_id: number; status: string }>("SELECT id, user_id, friend_user_id, status FROM friendships WHERE (user_id = $1 AND friend_user_id = $2) OR (user_id = $2 AND friend_user_id = $1)", [request.session!.userId, target.id]);
  if (existing.rows[0]) {
    if (existing.rows[0].status === "accepted") return response.status(409).json({ success: false, error: "You're already friends." });
    if (existing.rows[0].friend_user_id === request.session!.userId) {
      await pool.query("UPDATE friendships SET status = 'accepted' WHERE id = $1", [existing.rows[0].id]);
      return response.json({ success: true, message: `You're now friends with ${target.name}!` });
    }
    return response.status(409).json({ success: false, error: "Request already sent." });
  }
  const count = await pool.query<{ count: string }>("SELECT count(*) FROM friendships WHERE (user_id = $1 OR friend_user_id = $1) AND status = 'accepted'", [request.session!.userId]);
  if (Number(count.rows[0]?.count ?? 0) >= MAX_FRIENDS) return response.status(400).json({ success: false, error: `You can have up to ${MAX_FRIENDS} friends.` });
  await pool.query("INSERT INTO friendships (user_id, friend_user_id) VALUES ($1, $2)", [request.session!.userId, target.id]);
  return response.json({ success: true, message: `Friend request sent to ${target.name}!` });
});

friendsRouter.post("/:id/accept", async (request, response) => {
  const result = await pool.query("UPDATE friendships SET status = 'accepted' WHERE id = $1 AND friend_user_id = $2 AND status = 'pending'", [request.params.id, request.session!.userId]);
  return result.rowCount ? response.json({ success: true }) : response.status(404).json({ success: false, error: "Request not found." });
});

friendsRouter.post("/:id/decline", async (request, response) => {
  const result = await pool.query("DELETE FROM friendships WHERE id = $1 AND friend_user_id = $2 AND status = 'pending'", [request.params.id, request.session!.userId]);
  return result.rowCount ? response.json({ success: true }) : response.status(404).json({ success: false, error: "Request not found." });
});

friendsRouter.delete("/:id", async (request, response) => {
  await pool.query("DELETE FROM friendships WHERE id = $1 AND (user_id = $2 OR friend_user_id = $2)", [request.params.id, request.session!.userId]);
  return response.json({ success: true });
});

friendsRouter.get("/compare/:friendUserId", async (request, response) => {
  const friendId = Number(request.params.friendUserId);
  const relationship = await pool.query(
    `SELECT 1 FROM friendships
      WHERE status = 'accepted'
        AND ((user_id = $1 AND friend_user_id = $2) OR (user_id = $2 AND friend_user_id = $1))`,
    [request.session!.userId, friendId],
  );
  if (!relationship.rowCount) return response.status(403).json({ error: "You're not friends with this student." });
  const friend = await pool.query<{ name: string; enrollment_id: string }>("SELECT name, enrollment_id FROM users WHERE id = $1", [friendId]);
  if (!friend.rows[0]) return response.status(404).json({ error: "Student not found." });
  const period = currentPeriod();
  const [mine, theirs] = await Promise.all([
    getCachedAttendance(request.session!.enrollmentId, period.year, period.month),
    getCachedAttendance(friend.rows[0].enrollment_id, period.year, period.month),
  ]);
  const me = summarize(mine);
  const other = summarize(theirs);
  const friendSubjects = new Map(other.subjects.map((subject) => [subject.name, subject.pct]));
  const subjects = [...new Set([...me.subjects.map((subject) => subject.name), ...other.subjects.map((subject) => subject.name)])].sort().map((name) => {
    const mePct = me.subjects.find((subject) => subject.name === name)?.pct ?? null;
    const friendPct = friendSubjects.get(name) ?? null;
    return { name, mePct, friendPct, delta: mePct != null && friendPct != null ? mePct - friendPct : null };
  });
  return response.json({ month: period.month, year: period.year, me: { name: "You", total: me.total, present: me.present, pct: me.pct, subjects: me.subjects }, friend: { name: friend.rows[0].name, total: other.total, present: other.present, pct: other.pct, subjects: other.subjects }, subjects });
});
