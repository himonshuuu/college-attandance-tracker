import { Router, type Response } from "express";
import { z } from "zod";
import { env } from "../../config/env";
import { pool, withTransaction } from "../../db/pool";
import { createUser, findUserByEmail, findUserById } from "../users/users.repository";
import { generateToken, hashPassword, sha256Hex, verifyPassword } from "./crypto";
import { createSession, destroySession, requestToken, requireAuth } from "./session";
import { CollegePortalError, fetchStudentProfile } from "../college/college.service";
import { findUserByEnrollment } from "../users/users.repository";
import { log } from "../../observability/logger";

export const authRouter = Router();
const resetTtlMs = 60 * 60 * 1000;

const credentialsSchema = z.object({ email: z.string().email().transform((v) => v.trim().toLowerCase()), password: z.string().min(1) });
const registerSchema = credentialsSchema.extend({
  password: z.string().min(6),
  enrollmentId: z.string().trim().min(1).max(128),
  name: z.string().trim().max(200).optional(),
  className: z.string().trim().max(200).optional(),
  stream: z.string().trim().max(200).optional(),
  rollNumber: z.string().trim().max(100).optional(),
  profilePhotoUrl: z.string().trim().max(2_000).optional(),
});

function setAuthCookie(response: Response, token: string): void {
  response.cookie("auth_token", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.COOKIE_SECURE,
    maxAge: env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

authRouter.post("/register", async (request, response) => {
  const body = registerSchema.parse(request.body);
  if (await findUserByEmail(body.email)) return response.status(409).json({ success: false, error: "Email is already registered." });
  if (await findUserByEnrollment(body.enrollmentId)) return response.status(409).json({ success: false, error: "Enrollment ID is already linked to an account." });

  let profile;
  try {
    profile = await fetchStudentProfile(body.enrollmentId);
  } catch (error) {
    log("error", "college-registration-lookup-failed", { requestId: request.requestId, kind: error instanceof CollegePortalError ? error.kind : "unknown", error: error instanceof Error ? error.message : String(error) });
    return response.status(400).json({ success: false, error: "Could not verify enrollment ID with college portal." });
  }

  const passwordHash = hashPassword(body.password);
  try {
    const user = await createUser({
      email: body.email,
      passwordHash,
      enrollmentId: body.enrollmentId,
      name: profile.name,
      className: profile.className,
      stream: profile.stream,
      rollNumber: profile.rollNumber,
      profilePhotoUrl: profile.profilePhotoUrl,
    });
    const token = await createSession(user.id, user.email, user.enrollment_id);
    setAuthCookie(response, token);
    return response.status(201).json({ success: true, token, message: "Account created!" });
  } catch (error: unknown) {
    if ((error as { code?: string }).code === "23505") return response.status(409).json({ success: false, error: "Enrollment ID is already linked to an account." });
    throw error;
  }
});

authRouter.post("/login", async (request, response) => {
  const body = credentialsSchema.parse(request.body);
  const user = await findUserByEmail(body.email);
  if (!user || !user.active || !verifyPassword(body.password, user.password_hash)) {
    return response.status(401).json({ success: false, error: "Invalid email or password." });
  }
  const token = await createSession(user.id, user.email, user.enrollment_id);
  setAuthCookie(response, token);
  return response.json({ success: true, token });
});

authRouter.post("/logout", async (request, response) => {
  const token = requestToken(request);
  if (token) await destroySession(token);
  response.clearCookie("auth_token", { httpOnly: true, sameSite: "lax", secure: env.COOKIE_SECURE, path: "/" });
  return response.json({ success: true });
});

authRouter.get("/me", (request, response) => {
  if (!request.session) return response.json({ authenticated: false });
  return response.json({ authenticated: true, email: request.session.email, enrollmentId: request.session.enrollmentId });
});

authRouter.post("/change-password", requireAuth, async (request, response) => {
  const body = z.object({ currentPassword: z.string(), newPassword: z.string().min(6) }).parse(request.body);
  const user = await findUserById(request.session!.userId);
  if (!user || !verifyPassword(body.currentPassword, user.password_hash)) return response.status(401).json({ success: false, error: "Current password is incorrect." });
  await pool.query("UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2", [hashPassword(body.newPassword), user.id]);
  await pool.query("DELETE FROM sessions WHERE user_id = $1 AND token <> $2", [user.id, requestToken(request)]);
  return response.json({ success: true, message: "Password changed." });
});

authRouter.post("/forgot-password", async (request, response) => {
  const generic = { success: true, message: "If an account exists for that email, a reset link has been sent." };
  const parsed = z.object({ email: z.string().email().transform((v) => v.trim().toLowerCase()) }).safeParse(request.body);
  if (!parsed.success) return response.json(generic);
  const user = await findUserByEmail(parsed.data.email);
  if (!user) return response.json(generic);
  const token = generateToken();
  await pool.query("DELETE FROM password_resets WHERE expires_at <= now()", []);
  await pool.query(
    `INSERT INTO password_resets (user_id, email, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [user.id, user.email, sha256Hex(token), new Date(Date.now() + resetTtlMs)],
  );
  if (env.NODE_ENV !== "production") console.info(JSON.stringify({ event: "password-reset-development-link", token }));
  return response.json(generic);
});

authRouter.get("/reset-password", async (request, response) => {
  const token = String(request.query.token ?? "");
  const result = await pool.query("SELECT expires_at, used_at FROM password_resets WHERE token_hash = $1", [sha256Hex(token)]);
  const row = result.rows[0];
  const valid = Boolean(row && !row.used_at && new Date(row.expires_at) > new Date());
  return response.status(valid ? 200 : 400).json(valid ? { success: true, valid: true } : { success: false, valid: false, error: "This reset link is invalid or has expired." });
});

authRouter.post("/reset-password", async (request, response) => {
  const body = z.object({ token: z.string().min(1), password: z.string().min(6) }).parse(request.body);
  const result = await pool.query<{ id: number; user_id: number }>(
    `SELECT id, user_id FROM password_resets
      WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
    [sha256Hex(body.token)],
  );
  const row = result.rows[0];
  if (!row) return response.status(400).json({ success: false, error: "This reset link is invalid or has expired." });
  await withTransaction(async (client) => {
    await client.query("UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2", [hashPassword(body.password), row.user_id]);
    await client.query("UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL", [row.user_id]);
    await client.query("DELETE FROM sessions WHERE user_id = $1", [row.user_id]);
  });
  return response.json({ success: true, message: "Password has been reset. Please sign in." });
});
