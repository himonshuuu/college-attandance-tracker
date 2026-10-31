import { z } from "zod";

export const feedbackSchema = z.object({
	message: z
		.string()
		.trim()
		.min(5, "Please write at least 5 characters.")
		.max(2000, "Keep it under 2000 characters."),
	rating: z.coerce
		.number()
		.int("Rating must be a whole number.")
		.min(1, "Rating must be between 1 and 5.")
		.max(5, "Rating must be between 1 and 5."),
	name: z.string().trim().max(80, "Name is too long.").optional().default(""),
});

export type FeedbackInput = z.infer<typeof feedbackSchema>;

export function parseFeedback(body: Record<string, unknown>): FeedbackInput {
	return feedbackSchema.parse({
		message: body.message,
		rating: body.rating,
		name: body.name,
	});
}
