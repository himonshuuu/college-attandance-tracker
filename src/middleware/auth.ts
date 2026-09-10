import { createMiddleware } from "hono/factory";
import type { Env } from "../types";
import { validateSession, getTokenFromRequest } from "../auth/session";

export interface SessionData {
  userId: number;
  email: string;
  enrollmentId: string;
  createdAt: string;
}

export type HonoEnv = {
  Bindings: Env;
  Variables: {
    session?: SessionData;
  };
};

export const sessionMiddleware = createMiddleware<HonoEnv>(async (c, next) => {
  const token = getTokenFromRequest(c.req.raw);
  if (token) {
    const session = await validateSession(c.env, token);
    if (session) {
      c.set("session", session);
    }
  }
  await next();
});

export const requireAuth = createMiddleware<HonoEnv>(async (c, next) => {
  const session = c.get("session");
  if (!session) {
    return c.json({ success: false, error: "Unauthorized / Session expired" }, 401);
  }
  await next();
});
