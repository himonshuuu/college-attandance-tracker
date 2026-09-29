import { z } from "zod";

export const credentialsSchema = z.object({
	email: z
		.string()
		.email()
		.transform((v) => v.trim().toLowerCase()),
	password: z.string().min(1),
});

export const registerSchema = credentialsSchema.extend({
	password: z.string().min(6),
	enrollmentId: z.string().trim().min(1).max(128),
	name: z.string().trim().max(200).optional(),
	className: z.string().trim().max(200).optional(),
	stream: z.string().trim().max(200).optional(),
	rollNumber: z.string().trim().max(100).optional(),
	profilePhotoUrl: z.string().trim().max(2_000).optional(),
});

export const changePasswordSchema = z.object({
	currentPassword: z.string(),
	newPassword: z.string().min(6),
});

export const forgotPasswordSchema = z.object({
	email: z
		.string()
		.email()
		.transform((v) => v.trim().toLowerCase()),
});

export const resetPasswordSchema = z.object({
	token: z.string().min(1),
	password: z.string().min(6),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type CredentialsInput = z.infer<typeof credentialsSchema>;
