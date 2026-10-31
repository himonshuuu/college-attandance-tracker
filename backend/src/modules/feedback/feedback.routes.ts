import { Router } from "express";
import { postFeedback } from "./feedback.controller";

/**
 * Open to signed-out visitors too — the downtime email links straight here and
 * forcing a login would lose most responses. Identity comes from the typed
 * name (required) plus the session email when one exists.
 */
export const feedbackRouter = Router();

feedbackRouter.post("/", postFeedback);
