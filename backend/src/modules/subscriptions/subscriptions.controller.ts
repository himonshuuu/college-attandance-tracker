import type { Request, Response } from "express";
import {
	getSubscriptionState,
	saveSubscriptionState,
} from "./subscriptions.service";

export async function getSubscriptionsHandler(
	request: Request,
	response: Response,
) {
	return response.json(
		await getSubscriptionState(
			request.session!.enrollmentId,
			request.session!.email,
		),
	);
}

export async function saveSubscriptionsHandler(
	request: Request,
	response: Response,
) {
	const result = await saveSubscriptionState(
		request.session!.enrollmentId,
		request.session!.email,
		request.body as Record<string, unknown>,
	);
	if (
		request.is("application/x-www-form-urlencoded") ||
		request.is("multipart/form-data")
	) {
		response.redirect("/subscribe?saved=1");
		return response;
	}
	return response.json({ success: true, message: result.message });
}
