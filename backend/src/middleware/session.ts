import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env";
import { pool } from "../db/pool";
import { generateToken } from "../utils/crypto";

export interface Session {
	userId: number;
	email: string;
	enrollmentId: string;
	expiresAt: string;
}

export async function createSession(
	userId: number,
	email: string,
	enrollmentId: string,
): Promise<string> {
	const token = generateToken();
	const expiresAt = new Date(
		Date.now() + env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
	);
	await pool.query(
		`INSERT INTO sessions (token, user_id, email, enrollment_id, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
		[token, userId, email, enrollmentId, expiresAt],
	);
	return token;
}

export async function validateSession(token: string): Promise<Session | null> {
	const result = await pool.query<{
		user_id: string;
		email: string;
		enrollment_id: string;
		expires_at: Date;
	}>(
		`SELECT user_id, email, enrollment_id, expires_at
       FROM sessions
      WHERE token = $1 AND expires_at > now()`,
		[token],
	);
	const row = result.rows[0];
	if (!row) return null;
	return {
		userId: Number(row.user_id),
		email: row.email,
		enrollmentId: row.enrollment_id,
		expiresAt: new Date(row.expires_at).toISOString(),
	};
}

export async function destroySession(token: string): Promise<void> {
	await pool.query("DELETE FROM sessions WHERE token = $1", [token]);
}

function tokenFromRequest(request: Request): string | null {
	const auth = request.header("authorization");
	if (auth?.startsWith("Bearer ")) return auth.slice("Bearer ".length).trim();
	return request.cookies?.auth_token ?? null;
}

export async function sessionMiddleware(
	request: Request,
	_response: Response,
	next: NextFunction,
): Promise<void> {
	try {
		const token = tokenFromRequest(request);
		if (token) request.session = (await validateSession(token)) ?? undefined;
		next();
	} catch (error) {
		next(error);
	}
}

export function requireAuth(
	request: Request,
	response: Response,
	next: NextFunction,
): void {
	if (!request.session) {
		response
			.status(401)
			.json({ success: false, error: "Unauthorized / Session expired" });
		return;
	}
	next();
}

export function requestToken(request: Request): string | null {
	return tokenFromRequest(request);
}
