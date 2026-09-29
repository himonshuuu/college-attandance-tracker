import { z } from "zod";

export const addFriendSchema = z.object({
	query: z.string().trim().min(1),
});

export function parseAddFriendQuery(body: Record<string, unknown>): string {
	const raw = body.email ?? body.enrollmentId ?? body.query;
	return addFriendSchema.parse({ query: raw }).query;
}
