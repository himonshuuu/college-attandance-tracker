import type { Request, Response } from "express";
import { getLeaderboard } from "./leaderboard.service";

export async function getBoard(_request: Request, response: Response) {
	return response.json(await getLeaderboard());
}
