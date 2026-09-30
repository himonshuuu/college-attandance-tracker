import { Router } from "express";
import { getBoard, getClasses } from "./leaderboard.controller";

export const leaderboardRouter = Router();

leaderboardRouter.get("/", getBoard);
leaderboardRouter.get("/classes", getClasses);
