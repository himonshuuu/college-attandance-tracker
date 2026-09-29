import { Router } from "express";
import { getBoard } from "./leaderboard.controller";

export const leaderboardRouter = Router();

leaderboardRouter.get("/", getBoard);
