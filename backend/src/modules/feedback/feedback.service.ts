import { pool } from "../../db/pool";
import type { FeedbackInput } from "./feedback.validators";

export class FeedbackError extends Error {
	status: number;

	constructor(message: string, status = 400) {
		super(message);
		this.name = "FeedbackError";
		this.status = status;
	}
}

/** Anonymous submissions are capped per identity per day to slow spam. */
const MAX_PER_DAY = 5;

export interface FeedbackResult {
	id: string;
	rating: number;
}

export async function submitFeedback(
	userId: number | null,
	email: string,
	input: FeedbackInput,
): Promise<FeedbackResult> {
	const identityValue = userId != null ? String(userId) : email.trim();
	if (identityValue) {
		const identityColumn = userId != null ? "user_id" : "email";
		const recent = await pool.query(
			`SELECT count(*)::int AS count FROM feedback
			 WHERE ${identityColumn} = $1 AND created_at > now() - interval '1 day'`,
			[identityValue],
		);
		if ((recent.rows[0]?.count ?? 0) >= MAX_PER_DAY) {
			throw new FeedbackError(
				"You have already sent 5 feedbacks today. Try again tomorrow!",
				429,
			);
		}
	}

	let name = input.name;
	if (!name && userId != null) {
		const profile = await pool.query<{ name: string }>(
			"SELECT name FROM users WHERE id = $1",
			[userId],
		);
		name = profile.rows[0]?.name ?? "";
	}

	const inserted = await pool.query<{ id: string }>(
		`INSERT INTO feedback (user_id, email, name, rating, message)
		 VALUES ($1, $2, $3, $4, $5)
		 RETURNING id`,
		[userId, email.trim(), name, input.rating, input.message],
	);

	return { id: String(inserted.rows[0].id), rating: input.rating };
}
