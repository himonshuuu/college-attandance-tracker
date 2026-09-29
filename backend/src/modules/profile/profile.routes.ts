import { Router } from "express";
import { requireAuth } from "../../middleware/session";
import { getMyProfile } from "./profile.controller";

export const profileRouter = Router();
profileRouter.use(requireAuth);

profileRouter.get("/", getMyProfile);
