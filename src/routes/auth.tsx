import { Hono } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import type { HonoEnv } from "../middleware/auth";
import { hashPassword, verifyPassword } from "../auth/crypto";
import { createSession, destroySession, getTokenFromRequest } from "../auth/session";
import { sendWelcomeEmail } from "../notify/notify";
import { fetchStudentProfile } from "../college/api";

export const authRouter = new Hono<HonoEnv>();

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
