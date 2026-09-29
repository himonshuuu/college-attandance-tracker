import nodemailer from "nodemailer";
import { env } from "../../config/env";
import { log } from "../../observability/logger";

async function sendThroughResend(
	to: string,
	subject: string,
	text: string,
	html?: string,
): Promise<void> {
	if (!env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not configured");
	const payload: Record<string, unknown> = {
		from: env.RESEND_FROM,
		to: [to],
		subject,
		text,
	};
	if (html) payload.html = html;
	const response = await fetch("https://api.resend.com/emails", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${env.RESEND_API_KEY}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(payload),
	});
	if (!response.ok) throw new Error(`Resend API Error ${response.status}`);
}

const sesTransporter =
	env.SES_SMTP_USERNAME && env.SES_SMTP_PASSWORD
		? nodemailer.createTransport({
				host: env.SES_SMTP_HOST,
				port: env.SES_SMTP_PORT,
				secure: env.SES_SMTP_PORT === 465,
				auth: { user: env.SES_SMTP_USERNAME, pass: env.SES_SMTP_PASSWORD },
			})
		: null;

async function sendThroughSes(
	to: string,
	subject: string,
	text: string,
	html?: string,
): Promise<void> {
	if (!sesTransporter)
		throw new Error("SES SMTP credentials are not configured");
	await sesTransporter.sendMail({
		from: env.SES_FROM,
		to,
		subject,
		text,
		...(html ? { html } : {}),
	});
}

export async function sendEmail(
	to: string,
	subject: string,
	text: string,
	html?: string,
): Promise<void> {
	let sesError: unknown;
	if (sesTransporter) {
		try {
			await sendThroughSes(to, subject, text, html);
			log("debug", "email-sent", { provider: "aws-ses" });
			return;
		} catch (error) {
			sesError = error;
			log("warn", "ses-email-failed-falling-back", {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
	if (env.RESEND_API_KEY) {
		try {
			await sendThroughResend(to, subject, text, html);
			log("debug", "email-sent", { provider: "resend-fallback" });
			return;
		} catch (error) {
			throw new Error(
				`SES and Resend email delivery failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
	if (sesError instanceof Error) throw sesError;
	log("warn", "email-notification-skipped", {
		reason: "No SES or Resend credentials are configured",
	});
}
