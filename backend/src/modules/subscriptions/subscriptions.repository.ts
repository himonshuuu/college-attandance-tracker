import { pool } from "../../db/pool";

export type SubscriptionMethod = "browser" | "email" | "monthly_report";

export interface SubscriptionRow {
	method: string;
	email: string | null;
}

export async function listSubscriptions(
	enrollmentId: string,
): Promise<SubscriptionRow[]> {
	const result = await pool.query<SubscriptionRow>(
		"SELECT method, email FROM subscriptions WHERE enrollment_id = $1",
		[enrollmentId],
	);
	return result.rows;
}

export async function replaceSubscriptions(
	enrollmentId: string,
	email: string,
	methods: SubscriptionMethod[],
	pushSubscription: unknown,
): Promise<void> {
	const client = await pool.connect();
	try {
		await client.query("BEGIN");
		await client.query("DELETE FROM subscriptions WHERE enrollment_id = $1", [
			enrollmentId,
		]);
		for (const method of methods) {
			await client.query(
				`INSERT INTO subscriptions (enrollment_id, method, email, push_subscription)
         VALUES ($1, $2, $3, $4)`,
				[
					enrollmentId,
					method,
					method === "email" || method === "monthly_report" ? email : null,
					method === "browser" && pushSubscription
						? typeof pushSubscription === "string"
							? pushSubscription
							: JSON.stringify(pushSubscription)
						: null,
				],
			);
		}
		await client.query("COMMIT");
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	} finally {
		client.release();
	}
}
