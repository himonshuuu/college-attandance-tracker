import { Hono } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import type { HonoEnv } from "../middleware/auth";
import { hashPassword, verifyPassword, generateToken } from "../auth/crypto";
import { createSession, destroySession, getTokenFromRequest } from "../auth/session";
import { sendWelcomeEmail, sendPasswordResetEmail } from "../notify/notify";
import { fetchStudentProfile } from "../college/api";

export const authRouter = new Hono<HonoEnv>();

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const RESET_RATE_LIMIT_PER_HOUR = 5;

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

authRouter.post("/register", async (c) => {
  const isForm = c.req.header("content-type")?.includes("application/x-www-form-urlencoded") || c.req.header("content-type")?.includes("multipart/form-data");

  let email = "";
  let password = "";
  let enrollmentId = "";

  if (isForm) {
    const body = await c.req.parseBody();
    email = String(body.email || "").trim().toLowerCase();
    password = String(body.password || "");
    enrollmentId = String(body.enrollmentId || body.eid || "").trim();
  } else {
    try {
      const body = (await c.req.json()) as Record<string, unknown>;
      email = String(body.email || "").trim().toLowerCase();
      password = String(body.password || "");
      enrollmentId = String(body.enrollmentId || body.eid || "").trim();
    } catch {
      return c.json({ success: false, error: "Invalid JSON" }, 400);
    }
  }

  if (!email || !email.includes("@")) {
    return c.json({ success: false, error: "Valid email address required." }, 400);
  }
  if (password.length < 6) {
    return c.json({ success: false, error: "Password must be at least 6 characters." }, 400);
  }
  if (!enrollmentId) {
    return c.json({ success: false, error: "Enrollment ID is required." }, 400);
  }

  const exists = await c.env.DB.prepare(`SELECT id FROM users WHERE email = ?`).bind(email).first();
  if (exists) {
    return c.json({ success: false, error: "Email is already registered." }, 409);
  }

  const enrollExists = await c.env.DB.prepare(`SELECT id FROM users WHERE enrollment_id = ?`).bind(enrollmentId).first();
  if (enrollExists) {
    return c.json({ success: false, error: "Enrollment ID is already linked to an account." }, 409);
  }

  let profile;
  try {
    profile = await fetchStudentProfile(c.env, enrollmentId);
  } catch {
    return c.json({ success: false, error: "Could not verify enrollment ID with college portal." }, 400);
  }

  const passwordHash = await hashPassword(password);
  await c.env.DB.prepare(
    `INSERT INTO users (email, password_hash, enrollment_id, name, class_name, stream, roll_number, profile_photo_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    email,
    passwordHash,
    enrollmentId,
    profile.name,
    profile.className,
    profile.stream,
    profile.rollNumber,
    profile.profilePhotoUrl,
  ).run();

  const user = await c.env.DB.prepare(`SELECT id FROM users WHERE enrollment_id = ?`).bind(enrollmentId).first<{ id: number }>();
  const token = await createSession(c.env, user!.id, email, enrollmentId);

  setCookie(c, "auth_token", token, {
    path: "/",
    maxAge: 15 * 24 * 60 * 60,
    sameSite: "Lax",
  });

  sendWelcomeEmail(c.env, email, enrollmentId).catch(() => {});

  if (isForm) return c.redirect("/");
  return c.json({ success: true, token, message: "Account created!" });
});

authRouter.post("/login", async (c) => {
  const isForm = c.req.header("content-type")?.includes("application/x-www-form-urlencoded") || c.req.header("content-type")?.includes("multipart/form-data");

  let email = "";
  let password = "";

  if (isForm) {
    const body = await c.req.parseBody();
    email = String(body.email || "").trim().toLowerCase();
    password = String(body.password || "");
  } else {
    try {
      const body = (await c.req.json()) as Record<string, unknown>;
      email = String(body.email || "").trim().toLowerCase();
      password = String(body.password || "");
    } catch {
      return c.json({ success: false, error: "Invalid JSON" }, 400);
    }
  }

  if (!email || !password) {
    return c.json({ success: false, error: "Email and password required." }, 400);
  }

  const user = await c.env.DB.prepare(
    `SELECT id, email, password_hash, enrollment_id FROM users WHERE email = ?`
  ).bind(email).first<{ id: number; email: string; password_hash: string; enrollment_id: string }>();

  if (!user) {
    return c.json({ success: false, error: "Invalid email or password." }, 401);
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    return c.json({ success: false, error: "Invalid email or password." }, 401);
  }

  const token = await createSession(c.env, user.id, user.email, user.enrollment_id);

  setCookie(c, "auth_token", token, {
    path: "/",
    maxAge: 15 * 24 * 60 * 60,
    sameSite: "Lax",
  });

  if (isForm) return c.redirect("/");
  return c.json({ success: true, token });
});

authRouter.get("/logout", async (c) => {
  const token = getTokenFromRequest(c.req.raw);
  if (token) await destroySession(c.env, token);
  deleteCookie(c, "auth_token", { path: "/" });
  return c.redirect("/");
});

authRouter.post("/logout", async (c) => {
  const token = getTokenFromRequest(c.req.raw);
  if (token) await destroySession(c.env, token);
  deleteCookie(c, "auth_token", { path: "/" });
  const isForm = c.req.header("content-type")?.includes("application/x-www-form-urlencoded");
  if (isForm) return c.redirect("/");
  return c.json({ success: true });
});

authRouter.get("/me", (c) => {
  const session = c.get("session");
  if (!session) return c.json({ authenticated: false });
  return c.json({ authenticated: true, email: session.email, enrollmentId: session.enrollmentId });
});

authRouter.post("/forgot-password", async (c) => {
  let email = "";
  try {
    const ct = c.req.header("content-type") || "";
    if (ct.includes("application/x-www-form-urlencoded") || ct.includes("multipart/form-data")) {
      const body = await c.req.parseBody();
      email = String(body.email || "").trim().toLowerCase();
    } else {
      const body = (await c.req.json()) as Record<string, unknown>;
      email = String(body.email || "").trim().toLowerCase();
    }
  } catch {
    return c.json({ success: false, error: "Invalid request." }, 400);
  }

  // Generic response to avoid email enumeration.
  const generic = () =>
    c.json({ success: true, message: "If an account exists for that email, a reset link has been sent." });

  if (!email || !email.includes("@")) return generic();

  try {
    // Best-effort cleanup of expired tokens (timestamps stored as ISO strings).
    await c.env.DB.prepare(`DELETE FROM password_resets WHERE expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`).run().catch(() => {});

    // Rate limit: max N requests per email per hour.
    const recent = await c.env.DB.prepare(
      `SELECT COUNT(*) as count FROM password_resets WHERE email = ? AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour')`
    ).bind(email).first<{ count: number }>().catch(() => null);
    if (recent && recent.count >= RESET_RATE_LIMIT_PER_HOUR) return generic();

    const user = await c.env.DB.prepare(`SELECT id, email FROM users WHERE email = ?`)
      .bind(email).first<{ id: number; email: string }>();
    if (!user) return generic();

    const token = generateToken();
    const tokenHash = await sha256Hex(token);
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString();

    await c.env.DB.prepare(
      `INSERT INTO password_resets (user_id, email, token_hash, expires_at) VALUES (?, ?, ?, ?)`
    ).bind(user.id, user.email, tokenHash, expiresAt).run();

    const origin = new URL(c.req.url).origin;
    const resetLink = `${origin}/reset-password?resetToken=${token}`;

    try {
      await sendPasswordResetEmail(c.env, user.email, resetLink);
    } catch (err) {
      console.error(JSON.stringify({ event: "password-reset-email-failed", error: String(err) }));
    }

    return generic();
  } catch (err) {
    console.error(JSON.stringify({ event: "forgot-password-error", error: String(err) }));
    return generic();
  }
});

authRouter.get("/reset-password", async (c) => {
  const token = (c.req.query("token") || "").trim();
  if (!token) return c.json({ success: false, valid: false, error: "Reset token is required." }, 400);
  try {
    const tokenHash = await sha256Hex(token);
    const row = await c.env.DB.prepare(
      `SELECT expires_at, used_at FROM password_resets WHERE token_hash = ?`
    ).bind(tokenHash).first<{ expires_at: string; used_at: string | null }>();
    if (!row || row.used_at || new Date(row.expires_at) <= new Date()) {
      return c.json({ success: false, valid: false, error: "This reset link is invalid or has expired." }, 400);
    }
    return c.json({ success: true, valid: true });
  } catch {
    return c.json({ success: false, valid: false, error: "Could not verify reset token." }, 500);
  }
});

authRouter.post("/reset-password", async (c) => {
  let token = "";
  let password = "";
  try {
    const ct = c.req.header("content-type") || "";
    if (ct.includes("application/x-www-form-urlencoded") || ct.includes("multipart/form-data")) {
      const body = await c.req.parseBody();
      token = String(body.token || "").trim();
      password = String(body.password || body.newPassword || "");
    } else {
      const body = (await c.req.json()) as Record<string, unknown>;
      token = String(body.token || "").trim();
      password = String(body.password || body.newPassword || "");
    }
  } catch {
    return c.json({ success: false, error: "Invalid request." }, 400);
  }

  if (!token) {
    return c.json({ success: false, error: "Reset token is required." }, 400);
  }
  if (password.length < 6) {
    return c.json({ success: false, error: "Password must be at least 6 characters." }, 400);
  }

  try {
    const tokenHash = await sha256Hex(token);
    const row = await c.env.DB.prepare(
      `SELECT id, user_id, email, expires_at, used_at FROM password_resets WHERE token_hash = ?`
    ).bind(tokenHash).first<{ id: number; user_id: number; email: string; expires_at: string; used_at: string | null }>();

    if (!row || row.used_at || new Date(row.expires_at) <= new Date()) {
      return c.json({ success: false, error: "This reset link is invalid or has expired. Please request a new one." }, 400);
    }

    const passwordHash = await hashPassword(password);
    await c.env.DB.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).bind(passwordHash, row.user_id).run();

    // Single-use: mark this token used and invalidate all other active tokens for the user.
    const now = new Date().toISOString();
    await c.env.DB.prepare(`UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL`)
      .bind(now, row.user_id).run();

    // Force re-login everywhere by clearing existing sessions.
    await c.env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(row.user_id).run().catch(() => {});

    const isForm = (c.req.header("content-type") || "").includes("application/x-www-form-urlencoded");
    if (isForm) return c.redirect("/?reset=success");
    return c.json({ success: true, message: "Password has been reset. Please sign in." });
  } catch (err) {
    console.error(JSON.stringify({ event: "reset-password-error", error: String(err) }));
    return c.json({ success: false, error: "Could not reset password. Please try again." }, 500);
  }
});
