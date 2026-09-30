import { Router } from "express";
import { requireAuth } from "../../middleware/session";
import { getMyProfile } from "./profile.controller";
import {
	getSubjectsHandler,
	updateSubjectsHandler,
} from "./subjects.controller";

export const profileRouter = Router();
profileRouter.use(requireAuth);

profileRouter.get("/", getMyProfile);
profileRouter.get("/subjects", getSubjectsHandler);
profileRouter.put("/subjects", updateSubjectsHandler);
