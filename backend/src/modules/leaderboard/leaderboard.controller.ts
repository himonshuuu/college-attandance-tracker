import type { Request, Response } from "express";
import { getLeaderboard, getLeaderboardClasses } from "./leaderboard.service";
import { findUserByEnrollment } from "../users/users.repository";

export async function getBoard(request: Request, response: Response) {
	const classFilter = request.query.class?.toString();
	const user = await findUserByEnrollment(request.session!.enrollmentId);
	return response.json(
		await getLeaderboard(classFilter || undefined, user?.class_name),
	);
}

export async function getClasses(_request: Request, response: Response) {
	return response.json({ classes: await getLeaderboardClasses() });
}
