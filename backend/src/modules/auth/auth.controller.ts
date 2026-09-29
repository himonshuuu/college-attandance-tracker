import type { Request, Response } from "express";
import { z } from "zod";
import { env } from "../../config/env";
import { log } from "../../observability/logger";
import { events } from "../../infrastructure/events/event.bus";
import { CollegePortalError } from "../../integrations/college-php-api";
import {
	authCookieOptions,
	AuthError,
	changeUserPassword,
	loginUser,
	logoutUser,
	registerUserWithProfile,
	requestPasswordReset,
	resetPasswordWithToken,
	validateResetToken,
} from "./auth.service";
import {
	changePasswordSchema,
	credentialsSchema,
	forgotPasswordSchema,
	registerSchema,
	resetPasswordSchema,
} from "./auth.validators";
import { requestToken } from "../../middleware/session";

function handleAuthError(request: Request, response: Response, error: unknown) {
	if (error instanceof AuthError) {
		if (error.status === 400 && error.message.includes("college portal")) {
			log("error", "college-registration-lookup-failed", {
				requestId: request.requestId,
				kind: String((error.cause as string) ?? "unknown"),
				error: error.message,
			});
		}
		return response
			.status(error.status)
			.json({ success: false, error: error.message });
	}
	throw error;
}

export async function register(request: Request, response: Response) {
	try {
		const body = registerSchema.parse(request.body);
		const { user, token } = await registerUserWithProfile(body);
		response.cookie("auth_token", token, authCookieOptions());
		void events.publish("user.registered", {
			email: user.email,
			enrollmentId: user.enrollment_id,
			requestId: request.requestId,
		});
		return response
			.status(201)
			.json({ success: true, token, message: "Account created!" });
	} catch (error) {
		if (error instanceof CollegePortalError) {
			log("error", "college-registration-lookup-failed", {
				requestId: request.requestId,
			});
			return response
				.status(400)
				.json({ success: false, error: "Could not verify enrollment ID." });
		}
		return handleAuthError(request, response, error);
	}
}

export async function login(request: Request, response: Response) {
	try {
		const body = credentialsSchema.parse(request.body);
		const { token } = await loginUser(body.email, body.password);
		response.cookie("auth_token", token, authCookieOptions());
		return response.json({ success: true, token });
	} catch (error) {
		return handleAuthError(request, response, error);
	}
}

export async function logout(request: Request, response: Response) {
	await logoutUser(requestToken(request));
	response.clearCookie("auth_token", {
		httpOnly: true,
		sameSite: "lax",
		secure: env.COOKIE_SECURE,
		path: "/",
	});
	return response.json({ success: true });
}

export function me(request: Request, response: Response) {
	if (!request.session) return response.json({ authenticated: false });
	return response.json({
		authenticated: true,
		email: request.session.email,
		enrollmentId: request.session.enrollmentId,
	});
}

export async function changePassword(request: Request, response: Response) {
	try {
		const body = changePasswordSchema.parse(request.body);
		await changeUserPassword(
			request.session!.userId,
			requestToken(request),
			body.currentPassword,
			body.newPassword,
		);
		return response.json({ success: true, message: "Password changed." });
	} catch (error) {
		return handleAuthError(request, response, error);
	}
}

export async function forgotPassword(request: Request, response: Response) {
	const generic = {
		success: true,
		message: "If an account exists for that email, a reset link has been sent.",
	};
	const parsed = forgotPasswordSchema.safeParse(request.body);
	if (!parsed.success) return response.json(generic);
	const origin = env.APP_URL || `${request.protocol}://${request.get("host")}`;
	await requestPasswordReset(parsed.data.email, origin);
	return response.json(generic);
}

export async function verifyResetToken(request: Request, response: Response) {
	const token = String(request.query.token ?? "");
	const valid = await validateResetToken(token);
	return response.status(valid ? 200 : 400).json(
		valid
			? { success: true, valid: true }
			: {
					success: false,
					valid: false,
					error: "This reset link is invalid or has expired.",
				},
	);
}

export async function resetPassword(request: Request, response: Response) {
	try {
		const body = resetPasswordSchema.parse(request.body);
		await resetPasswordWithToken(body.token, body.password);
		return response.json({
			success: true,
			message: "Password has been reset. Please sign in.",
		});
	} catch (error) {
		if (error instanceof z.ZodError) throw error;
		return handleAuthError(request, response, error);
	}
}
