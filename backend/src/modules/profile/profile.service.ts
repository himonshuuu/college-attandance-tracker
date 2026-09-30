import { pool } from "../../db/pool";
import { findUserByEnrollment } from "../users/users.repository";
import { getClassRank } from "../leaderboard/leaderboard.repository";

export class ProfileError extends Error {
	constructor(
		message: string,
		public readonly status: number,
	) {
		super(message);
		this.name = "ProfileError";
	}
}

export async function getProfile(enrollmentId: string) {
	const user = await findUserByEnrollment(enrollmentId);
	if (!user) throw new ProfileError("User not found", 404);

	const now = new Date();
	const monthKey = `${now.getFullYear()}-${now.toLocaleString("en-US", { month: "long" })}`;
	const globalRank = await pool.query<{ rank: number }>(
		"SELECT rank FROM rank_snapshots WHERE enrollment_id = $1 AND month = $2",
		[enrollmentId, monthKey],
	);
	const classRank = await getClassRank(enrollmentId, monthKey);

	return {
		user: {
			email: user.email,
			enrollmentId: user.enrollment_id,
			joinedAt: user.created_at,
		},
		profile: {
			name: user.name,
			className: user.class_name,
			stream: user.stream,
			rollNumber: user.roll_number,
			profilePhotoUrl: user.profile_photo_url,
			globalRank: globalRank.rows[0]?.rank ?? null,
			classRank: classRank,
		},
	};
}
