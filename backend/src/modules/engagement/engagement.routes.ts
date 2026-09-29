import { Router } from "express";
import { requireAuth } from "../../middleware/session";
import {
	getEngagementOverview,
	getEngagementYearly,
} from "./engagement.controller";

export const engagementRouter = Router();
engagementRouter.use(requireAuth);

engagementRouter.get("/overview", getEngagementOverview);
engagementRouter.get("/yearly", getEngagementYearly);
