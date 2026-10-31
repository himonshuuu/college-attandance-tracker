import { pool } from "../../db/pool";
import { events } from "../../infrastructure/events/event.bus";
import type { FeedbackInput } from "./feedback.validators";

export class FeedbackError extends Error {
	status: number;

	constructor(message: string, status = 400) {
		super(message);
		this.name = "FeedbackError";
		this.status = status;
	}
}

/** One identity can send at most this many feedbacks per day. */
const MAX_PER_DAY = 5;

export interface FeedbackResult {
	id: string;
	rating: number;
}

/**
 * Submissions in the last day for whoever is sending: the account when we
 * know it, otherwise the email, otherwise the typed name — so anonymous
 * guests still hit the same cap.
 */
async function submissionsLastDay(
	userId: number | null,
	email: string,
	name: string,
): Promise<number> {
	const identity =
		userId != null
			? { clause: "user_id = $1", value: String(userId) }
			: email.trim()
				? { clause: "lower(email) = $1", value: email.trim().toLowerCase() }
				: { clause: "lower(name) = $1", value: name.toLowerCase() };

	const result = await pool.query<{ count: number }>(
		`SELECT count(*)::int AS count FROM feedback
		 WHERE ${identity.clause} AND created_at > now() - interval '1 day'`,
		[identity.value],
	);
	return result.rows[0]?.count ?? 0;
}

export async function submitFeedback(
	userId: number | null,
	email: string,
	input: FeedbackInput,
): Promise<FeedbackResult> {
	if ((await submissionsLastDay(userId, email, input.name)) >= MAX_PER_DAY) {
		throw new FeedbackError(
			"You have already sent 5 feedbacks today. Try again tomorrow!",
			429,
		);
	}

	const inserted = await pool.query<{ id: string }>(
		`INSERT INTO feedback (user_id, email, name, rating, message)
		 VALUES ($1, $2, $3, $4, $5)
		 RETURNING id`,
		[userId, email.trim(), input.name, input.rating, input.message],
	);

	const id = String(inserted.rows[0].id);

	// Fire-and-forget: Discord ping must never block or fail the submission.
	void events.publish("feedback.submitted", {
		id,
		rating: input.rating,
		message: input.message,
		name: input.name,
		email: email.trim(),
		userId,
	});

	return { id, rating: input.rating };
}
