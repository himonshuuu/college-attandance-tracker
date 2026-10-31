import type { Request, Response } from "express";
import { FeedbackError, submitFeedback } from "./feedback.service";
import { parseFeedback } from "./feedback.validators";

export async function postFeedback(request: Request, response: Response) {
	try {
		const input = parseFeedback((request.body ?? {}) as Record<string, unknown>);
		const result = await submitFeedback(
			request.session?.userId ?? null,
			request.session?.email ?? "",
			input,
		);
		return response.status(201).json({
			success: true,
			...result,
			message: "Thanks! Your feedback was recorded.",
		});
	} catch (error) {
		if (error instanceof FeedbackError) {
			return response
				.status(error.status)
				.json({ success: false, error: error.message });
		}
		throw error;
	}
}
