import { env } from "../../config/env";
import type { NotificationUser } from "./notification.types";

interface AttendanceLike {
	date: string;
	subject?: string;
	teacher?: string;
	classTiming?: string;
	status?: string | null;
}

export async function notifyDiscord(
	student: NotificationUser,
	record: AttendanceLike,
): Promise<void> {
	if (!env.DISCORD_WEBHOOK_URL) return;
	const present = record.status === "Present";
	const response = await fetch(env.DISCORD_WEBHOOK_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			allowed_mentions: { parse: [] },
			embeds: [
				{
					title: present ? "🟢 Present" : "🔴 Absent",
					color: present ? 0x2ecc71 : 0xe74c3c,
					fields: [
						{
							name: "Student",
							value: student.name || `ID ${student.id}`,
							inline: true,
						},
						{ name: "Subject", value: record.subject ?? "—", inline: true },
						{ name: "Teacher", value: record.teacher ?? "—", inline: true },
						{ name: "Date", value: record.date, inline: true },
						{ name: "Time", value: record.classTiming ?? "—", inline: true },
					],
					timestamp: new Date().toISOString(),
				},
			],
		}),
	});
	if (!response.ok)
		throw new Error(`Discord webhook returned HTTP ${response.status}`);
}

export async function notifyAuthError(
	student: NotificationUser,
): Promise<void> {
	if (!env.DISCORD_WEBHOOK_URL) return;
	const response = await fetch(env.DISCORD_WEBHOOK_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			allowed_mentions: { parse: [] },
			embeds: [
				{
					title: "⚠️ Auth Error",
					description: `College login failed for ${student.name}.`,
					color: 0xe67e22,
					timestamp: new Date().toISOString(),
				},
			],
		}),
	});
	if (!response.ok)
		throw new Error(`Discord webhook returned HTTP ${response.status}`);
}

export async function notifyNotUpdated(
	student: NotificationUser,
	details: { subject: string; teacher: string; date: string },
): Promise<void> {
	if (!env.DISCORD_WEBHOOK_URL) return;
	const response = await fetch(env.DISCORD_WEBHOOK_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			allowed_mentions: { parse: [] },
			embeds: [
				{
					title: "⚠️ Attendance Not Updated",
					description: `Attendance not available 30min after class for ${student.name}.`,
					color: 0xf1c40f,
					fields: [
						{ name: "Subject", value: details.subject, inline: true },
						{ name: "Teacher", value: details.teacher, inline: true },
						{ name: "Date", value: details.date, inline: true },
					],
					timestamp: new Date().toISOString(),
				},
			],
		}),
	});
	if (!response.ok)
		throw new Error(`Discord webhook returned HTTP ${response.status}`);
}
