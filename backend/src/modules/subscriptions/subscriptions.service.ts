import { env } from "../../config/env";
import { events } from "../../infrastructure/events/event.bus";
import {
	listSubscriptions,
	replaceSubscriptions,
	type SubscriptionMethod,
} from "./subscriptions.repository";

export function parseMethods(
	raw: Record<string, unknown>,
): SubscriptionMethod[] {
	const requestedMethods = Array.isArray(raw.methods)
		? raw.methods.map(String)
		: typeof raw.methods === "string"
			? [raw.methods]
			: [
					...(raw.method_email ? ["email"] : []),
					...(raw.method_browser || raw.method_firebase ? ["browser"] : []),
					...(raw.method_monthly_report ? ["monthly_report"] : []),
				];
	return [
		...new Set(
			requestedMethods
				.map((method) => (method === "firebase" ? "browser" : method))
				.filter(
					(method): method is SubscriptionMethod =>
						method === "browser" ||
						method === "email" ||
						method === "monthly_report",
				),
		),
	];
}

export function parsePushSubscription(raw: Record<string, unknown>): unknown {
	const value = raw.pushSubscription;
	if (value == null || value === "") return null;
	return value;
}

export async function getSubscriptionState(
	enrollmentId: string,
	sessionEmail: string,
) {
	const rows = await listSubscriptions(enrollmentId);
	const methods = rows.map((row) => row.method);
	const email =
		rows.find((row) => row.method === "email")?.email ?? sessionEmail;
	return {
		methods,
		email,
		hasBrowser: methods.includes("browser"),
		hasEmail: methods.includes("email"),
		hasMonthlyReport: methods.includes("monthly_report"),
		vapidKey: env.FIREBASE_VAPID_KEY,
	};
}

export async function saveSubscriptionState(
	enrollmentId: string,
	sessionEmail: string,
	body: Record<string, unknown>,
): Promise<{ message: string; methods: SubscriptionMethod[] }> {
	const methods = parseMethods(body);
	const pushSubscription = parsePushSubscription(body);
	await replaceSubscriptions(
		enrollmentId,
		sessionEmail,
		methods,
		pushSubscription,
	);
	void events.publish("subscriptions.updated", { enrollmentId });
	const message = methods.length
		? `Saved! Subscribed to ${methods
				.map((method) =>
					method === "browser"
						? "Browser Push"
						: method === "monthly_report"
							? "Monthly Report"
							: "Email",
				)
				.join(" and ")}.`
		: "Unsubscribed from all alerts.";
	return { message, methods };
}

export function isFormRequest(contentType: string | undefined): boolean {
	return Boolean(
		contentType?.includes("application/x-www-form-urlencoded") ||
			contentType?.includes("multipart/form-data"),
	);
}
