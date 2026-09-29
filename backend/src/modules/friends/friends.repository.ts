import { pool } from "../../db/pool";

export interface FriendshipRow {
	id: number;
	user_id: number;
	friend_user_id: number;
	status: string;
	from_name: string;
	from_eid: string;
	to_name: string;
	to_eid: string;
}

export const MAX_FRIENDS = 5;

export async function listFriendshipRows(
	userId: number,
): Promise<FriendshipRow[]> {
	const result = await pool.query<FriendshipRow>(
		`SELECT f.id, f.user_id, f.friend_user_id, f.status,
            u1.name AS from_name, u1.enrollment_id AS from_eid,
            u2.name AS to_name, u2.enrollment_id AS to_eid
       FROM friendships f
       JOIN users u1 ON u1.id = f.user_id
       JOIN users u2 ON u2.id = f.friend_user_id
      WHERE f.user_id = $1 OR f.friend_user_id = $1`,
		[userId],
	);
	return result.rows;
}

export async function findUserForFriendQuery(query: string) {
	const result = await pool.query<{
		id: number;
		name: string;
		enrollment_id: string;
	}>(
		"SELECT id, name, enrollment_id FROM users WHERE lower(email) = lower($1) OR lower(enrollment_id) = lower($1)",
		[query],
	);
	return result.rows[0] ?? null;
}

export async function findFriendship(userId: number, targetId: number) {
	const result = await pool.query<{
		id: number;
		user_id: number;
		friend_user_id: number;
		status: string;
	}>(
		"SELECT id, user_id, friend_user_id, status FROM friendships WHERE (user_id = $1 AND friend_user_id = $2) OR (user_id = $2 AND friend_user_id = $1)",
		[userId, targetId],
	);
	return result.rows[0] ?? null;
}

export async function countAcceptedFriends(userId: number): Promise<number> {
	const result = await pool.query<{ count: string }>(
		"SELECT count(*) FROM friendships WHERE (user_id = $1 OR friend_user_id = $1) AND status = 'accepted'",
		[userId],
	);
	return Number(result.rows[0]?.count ?? 0);
}

export async function createFriendRequest(
	userId: number,
	targetId: number,
): Promise<void> {
	await pool.query(
		"INSERT INTO friendships (user_id, friend_user_id) VALUES ($1, $2)",
		[userId, targetId],
	);
}

export async function acceptFriendshipById(
	id: string,
	userId: number,
): Promise<boolean> {
	const result = await pool.query(
		"UPDATE friendships SET status = 'accepted' WHERE id = $1 AND friend_user_id = $2 AND status = 'pending'",
		[id, userId],
	);
	return (result.rowCount ?? 0) > 0;
}

export async function markFriendshipAccepted(id: number): Promise<void> {
	await pool.query("UPDATE friendships SET status = 'accepted' WHERE id = $1", [
		id,
	]);
}

export async function declineFriendshipById(
	id: string,
	userId: number,
): Promise<boolean> {
	const result = await pool.query(
		"DELETE FROM friendships WHERE id = $1 AND friend_user_id = $2 AND status = 'pending'",
		[id, userId],
	);
	return (result.rowCount ?? 0) > 0;
}

export async function removeFriendshipById(
	id: string,
	userId: number,
): Promise<void> {
	await pool.query(
		"DELETE FROM friendships WHERE id = $1 AND (user_id = $2 OR friend_user_id = $2)",
		[id, userId],
	);
}

export async function isAcceptedFriend(
	userId: number,
	friendId: number,
): Promise<boolean> {
	const result = await pool.query(
		`SELECT 1 FROM friendships
      WHERE status = 'accepted'
        AND ((user_id = $1 AND friend_user_id = $2) OR (user_id = $2 AND friend_user_id = $1))`,
		[userId, friendId],
	);
	return (result.rowCount ?? 0) > 0;
}

export async function findUserByIdForCompare(id: number) {
	const result = await pool.query<{ name: string; enrollment_id: string }>(
		"SELECT name, enrollment_id FROM users WHERE id = $1",
		[id],
	);
	return result.rows[0] ?? null;
}
