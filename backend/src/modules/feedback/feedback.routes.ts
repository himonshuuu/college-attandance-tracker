import { Router } from "express";
import { postFeedback } from "./feedback.controller";

/**
 * Feedback stays open to signed-out visitors too — the downtime email links
 * straight here, and the recipient's browser may not have an active session.
 */
export const feedbackRouter = Router();

feedbackRouter.post("/", postFeedback);
