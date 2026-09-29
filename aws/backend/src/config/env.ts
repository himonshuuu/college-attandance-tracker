import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["silent", "error", "warn", "info", "debug"]).default("info"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  FRONTEND_ORIGIN: z.string().url().default("http://localhost:5173"),
  COOKIE_SECURE: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(15),
  COLLEGE_PROFILE_URL: z.string().url().optional().or(z.literal("")),
  COLLEGE_ATTENDANCE_URL: z.string().url().optional().or(z.literal("")),
  COLLEGE_LOGIN_URL: z.string().url().optional().or(z.literal("")),
  COLLEGE_LOGIN_REFERER: z.string().optional(),
  COLLEGE_ORIGIN: z.string().optional(),
  COLLEGE_REFERER: z.string().optional(),
});

export const env = envSchema.parse(process.env);
