import { Router } from "express";
import { requireAuth } from "../../middleware/session";
import {
	getSubscriptionsHandler,
	saveSubscriptionsHandler,
} from "./subscriptions.controller";

export const subscriptionsRouter = Router();
subscriptionsRouter.use(requireAuth);

subscriptionsRouter.get("/", getSubscriptionsHandler);
subscriptionsRouter.post("/", saveSubscriptionsHandler);
subscriptionsRouter.put("/", saveSubscriptionsHandler);
