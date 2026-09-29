import { env } from "../../config/env";
import { pool, withTransaction } from "../../db/pool";
import {
	CollegePortalError,
	fetchStudentProfile,
} from "../../integrations/college-php-api";
import {
	createUser,
	findUserByEmail,
	findUserByEnrollment,
	findUserById,
} from "../users/users.repository";
import {
	generateToken,
	hashPassword,
	sha256Hex,
	verifyPassword,
} from "../../utils/crypto";
import { createSession, destroySession } from "../../middleware/session";
import { events } from "../../infrastructure/events/event.bus";
import type { RegisterInput } from "./auth.validators";

const RESET_TTL_MS = 60 * 60 * 1000;

export class AuthError extends Error {
	constructor(
		message: string,
		public readonly status: number,
	) {
		super(message);
		this.name = "AuthError";
	}
}

// Returns the created user too, so the controller can fire the welcome email.
export async function registerUserWithProfile(input: RegisterInput) {
	if (await findUserByEmail(input.email))
		throw new AuthError("Email is already registered.", 409);
	if (await findUserByEnrollment(input.enrollmentId))
		throw new AuthError("Enrollment ID is already linked to an account.", 409);

	let profile;
	try {
		profile = await fetchStudentProfile(input.enrollmentId);
	} catch (error) {
		const kind = error instanceof CollegePortalError ? error.kind : "unknown";
		throw new AuthError(
			`Could not verify enrollment ID with college portal (${kind}).`,
			400,
		);
	}

	try {
		const user = await createUser({
			email: input.email,
			passwordHash: hashPassword(input.password),
			enrollmentId: input.enrollmentId,
			name: profile.name,
			className: profile.className,
			stream: profile.stream,
			rollNumber: profile.rollNumber,
			profilePhotoUrl: profile.profilePhotoUrl,
		});
		const token = await createSession(user.id, user.email, user.enrollment_id);
		return { user, token };
	} catch (error: unknown) {
		if ((error as { code?: string }).code === "23505")
			throw new AuthError(
				"Enrollment ID is already linked to an account.",
				409,
			);
		throw error;
	}
}

export async function loginUser(
	email: string,
	password: string,
): Promise<{ token: string }> {
	const user = await findUserByEmail(email);
	if (!user || !user.active || !verifyPassword(password, user.password_hash)) {
		throw new AuthError("Invalid email or password.", 401);
	}
	const token = await createSession(user.id, user.email, user.enrollment_id);
	return { token };
}

export async function logoutUser(token: string | null): Promise<void> {
	if (token) await destroySession(token);
}

export function authCookieOptions() {
	return {
		httpOnly: true,
		sameSite: "lax" as const,
		secure: env.COOKIE_SECURE,
		maxAge: env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
		path: "/",
	};
}

export async function changeUserPassword(
	userId: number,
	currentToken: string | null,
	currentPassword: string,
	newPassword: string,
): Promise<void> {
	const user = await findUserById(userId);
	if (!user || !verifyPassword(currentPassword, user.password_hash)) {
		throw new AuthError("Current password is incorrect.", 401);
	}
	await pool.query(
		"UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2",
		[hashPassword(newPassword), user.id],
	);
	await pool.query("DELETE FROM sessions WHERE user_id = $1 AND token <> $2", [
		user.id,
		currentToken,
	]);
}

export async function requestPasswordReset(
	email: string,
	origin: string,
): Promise<void> {
	const user = await findUserByEmail(email);
	if (!user) return;
	const token = generateToken();
	await pool.query("DELETE FROM password_resets WHERE expires_at <= now()", []);
	await pool.query(
		`INSERT INTO password_resets (user_id, email, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
		[
			user.id,
			user.email,
			sha256Hex(token),
			new Date(Date.now() + RESET_TTL_MS),
		],
	);
	// Decoupled via event — the auth module no longer imports the
	// notifications module (previously a lazy import to dodge the cycle).
	const resetLink = `${origin}/reset-password?token=${encodeURIComponent(token)}`;
	void events.publish("password.reset.requested", {
		email: user.email,
		resetLink,
	});
}

export async function validateResetToken(token: string): Promise<boolean> {
	if (!token) return false;
	const result = await pool.query(
		"SELECT expires_at, used_at FROM password_resets WHERE token_hash = $1",
		[sha256Hex(token)],
	);
	const row = result.rows[0];
	return Boolean(row && !row.used_at && new Date(row.expires_at) > new Date());
}

export async function resetPasswordWithToken(
	token: string,
	password: string,
): Promise<void> {
	const result = await pool.query<{ id: number; user_id: number }>(
		`SELECT id, user_id FROM password_resets
      WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
		[sha256Hex(token)],
	);
	const row = result.rows[0];
	if (!row)
		throw new AuthError("This reset link is invalid or has expired.", 400);
	await withTransaction(async (client) => {
		await client.query(
			"UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2",
			[hashPassword(password), row.user_id],
		);
		await client.query(
			"UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL",
			[row.user_id],
		);
		await client.query("DELETE FROM sessions WHERE user_id = $1", [
			row.user_id,
		]);
	});
}
