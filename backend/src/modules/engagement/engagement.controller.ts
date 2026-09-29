import type { Request, Response } from "express";
import { getOverview, getYearly } from "./engagement.stats.service";

export async function getEngagementOverview(
	request: Request,
	response: Response,
) {
	return response.json(
		await getOverview(request.session!.userId, request.session!.enrollmentId),
	);
}

export async function getEngagementYearly(
	request: Request,
	response: Response,
) {
	return response.json(
		await getYearly(
			request.session!.enrollmentId,
			request.query.year?.toString(),
		),
	);
}
