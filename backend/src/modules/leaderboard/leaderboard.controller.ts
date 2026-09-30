import type { Request, Response } from "express";
import { getLeaderboard, getLeaderboardClasses } from "./leaderboard.service";

export async function getBoard(request: Request, response: Response) {
	const classFilter = request.query.class?.toString();
	return response.json(await getLeaderboard(classFilter || undefined));
}

export async function getClasses(_request: Request, response: Response) {
	return response.json({ classes: await getLeaderboardClasses() });
}
