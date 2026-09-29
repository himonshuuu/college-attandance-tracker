import { Router } from "express";
import { requireAuth } from "../../middleware/session";
import { getAnalytics } from "./attendance.controller";

export const attendanceRouter = Router();
attendanceRouter.use(requireAuth);

attendanceRouter.get("/", getAnalytics);
