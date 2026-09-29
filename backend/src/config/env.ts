import { config } from "dotenv";
import { z } from "zod";

const env_file = process.env.NODE_ENV === "production" ? ".env" : ".env.dev";
config({ path: env_file });

const envSchema = z.object({
	NODE_ENV: z
		.enum(["development", "test", "production"])
		.default("development"),
	LOG_LEVEL: z
		.enum(["silent", "error", "warn", "info", "debug"])
		.default("info"),
	PORT: z.coerce.number().int().positive().default(4000),
	DATABASE_URL: z.string().min(1),
	FRONTEND_ORIGIN: z.string().url().default("http://localhost:5173"),
	COOKIE_SECURE: z
		.enum(["true", "false"])
		.default("false")
		.transform((v) => v === "true"),
	SESSION_TTL_DAYS: z.coerce.number().int().positive().default(15),
	COLLEGE_PROFILE_URL: z.string().url().optional().or(z.literal("")),
	COLLEGE_ATTENDANCE_URL: z.string().url().optional().or(z.literal("")),
	COLLEGE_LOGIN_URL: z.string().url().optional().or(z.literal("")),
	COLLEGE_LOGIN_REFERER: z.string().optional(),
	COLLEGE_ORIGIN: z.string().optional(),
	COLLEGE_REFERER: z.string().optional(),
	RESEND_API_KEY: z.string().optional().or(z.literal("")),
	RESEND_FROM: z.string().default("Attendance Monitor <noreply@himon.xyz>"),
	SES_SMTP_HOST: z.string().default("email-smtp.ap-south-1.amazonaws.com"),
	SES_SMTP_PORT: z.coerce.number().int().positive().default(587),
	SES_SMTP_USERNAME: z.string().optional().or(z.literal("")),
	SES_SMTP_PASSWORD: z.string().optional().or(z.literal("")),
	SES_FROM: z.string().default("Attendance Monitor <noreply@himon.xyz>"),
	DISCORD_WEBHOOK_URL: z.string().optional().or(z.literal("")),
	FIREBASE_SERVICE_ACCOUNT: z.string().optional().or(z.literal("")),
	FIREBASE_SERVER_KEY: z.string().optional().or(z.literal("")),
	FIREBASE_VAPID_KEY: z
		.string()
		.default(
			"BH2Mc0SDTxo1LZnxF2FQL-p2TlBRX1nfG0HNOSG3H0Yx8qBb8ZwD40suAFcBCg_8ZO4dMzQjUcOmTft_oCXg3wA",
		),
	FIREBASE_PROJECT_ID: z.string().optional().or(z.literal("")),
	APP_URL: z.string().url().optional().or(z.literal("")),
});

export const env = envSchema.parse(process.env);
