import { pool } from "../../db/pool";

export async function getUserMeta(userId: number) {
	const result = await pool.query<{ id: number; created_at: Date }>(
		"SELECT id, created_at FROM users WHERE id = $1",
		[userId],
	);
	return result.rows[0] ?? null;
}

export async function getUserRank(enrollmentId: string, monthKey: string) {
	const result = await pool.query<{ rank: number }>(
		"SELECT rank FROM rank_snapshots WHERE enrollment_id = $1 AND month = $2",
		[enrollmentId, monthKey],
	);
	return result.rows[0]?.rank ?? null;
}

export async function countActiveUsers(): Promise<number> {
	const result = await pool.query<{ count: string }>(
		"SELECT count(*) FROM users WHERE active = TRUE",
	);
	return Number(result.rows[0]?.count ?? 0);
}

export async function countAcceptedFriends(userId: number): Promise<number> {
	const result = await pool.query<{ count: string }>(
		"SELECT count(*) FROM friendships WHERE (user_id = $1 OR friend_user_id = $1) AND status = 'accepted'",
		[userId],
	);
	return Number(result.rows[0]?.count ?? 0);
}

export async function getOwnedBadges(userId: number): Promise<string[]> {
	const result = await pool.query<{ badge: string }>(
		"SELECT badge FROM user_badges WHERE user_id = $1",
		[userId],
	);
	return result.rows.map((row) => row.badge);
}

export async function insertBadges(
	userId: number,
	badges: string[],
): Promise<void> {
	for (const badge of badges)
		await pool.query(
			"INSERT INTO user_badges (user_id, badge) VALUES ($1, $2) ON CONFLICT DO NOTHING",
			[userId, badge],
		);
}
