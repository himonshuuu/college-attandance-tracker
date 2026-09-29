import { Router } from "express";
import {
	changePassword,
	forgotPassword,
	login,
	logout,
	me,
	register,
	resetPassword,
	verifyResetToken,
} from "./auth.controller";
import { requireAuth } from "../../middleware/session";

// Router only — request validation + business logic live in
// auth.controller.ts / auth.service.ts / auth.validators.ts.
export const authRouter = Router();

authRouter.post("/register", register);
authRouter.post("/login", login);
authRouter.post("/logout", logout);
authRouter.get("/me", me);
authRouter.post("/change-password", requireAuth, changePassword);
authRouter.post("/forgot-password", forgotPassword);
authRouter.get("/reset-password", verifyResetToken);
authRouter.post("/reset-password", resetPassword);
