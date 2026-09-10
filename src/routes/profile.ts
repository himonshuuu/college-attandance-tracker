import { Hono } from "hono";
import { requireAuth, type HonoEnv } from "../middleware/auth";

export const profileRouter = new Hono<HonoEnv>();

profileRouter.use("*", requireAuth);

profileRouter.get("/", async (c) => {
  const session = c.get("session")!;

  const user = await c.env.DB.prepare(
    `SELECT id, email, enrollment_id, name, class_name, stream, roll_number, profile_photo_url, created_at
     FROM users WHERE enrollment_id = ?`
  ).bind(session.enrollmentId).first<{
    id: number; email: string; enrollment_id: string; name: string;
    class_name: string; stream: string; roll_number: string;
    profile_photo_url: string; created_at: string;
  }>();

  if (!user) return c.json({ error: "User not found" }, 404);

  return c.json({
    user: { email: user.email, enrollmentId: user.enrollment_id, joinedAt: user.created_at },
    profile: {
      name: user.name,
      className: user.class_name,
      stream: user.stream,
      rollNumber: user.roll_number,
      profilePhotoUrl: user.profile_photo_url,
    },
  });
});
