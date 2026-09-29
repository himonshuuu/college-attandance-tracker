import { pool } from "../../db/pool";

export interface Subscription {
	id: number;
	enrollment_id: string;
	method: "browser" | "email" | "monthly_report" | string;
	email: string | null;
	push_subscription: string | null;
}

export async function getSubscriptions(
	enrollmentId: string,
): Promise<Subscription[]> {
	const result = await pool.query<Subscription>(
		`SELECT id, enrollment_id, method, email, push_subscription
       FROM subscriptions
      WHERE enrollment_id = $1
      ORDER BY id`,
		[enrollmentId],
	);
	return result.rows;
}
