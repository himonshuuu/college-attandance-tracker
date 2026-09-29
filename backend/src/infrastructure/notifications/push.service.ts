import { createSign } from "node:crypto";
import { env } from "../../config/env";

function rawFcmToken(value: string): string {
	try {
		const parsed = JSON.parse(value) as { token?: string; endpoint?: string };
		if (parsed.token) return parsed.token;
		if (parsed.endpoint) return parsed.endpoint.split("/").at(-1) ?? value;
	} catch {
		// Raw FCM token.
	}
	return value;
}

function base64Url(value: string | Buffer): string {
	return Buffer.from(value).toString("base64url");
}

export async function sendFcmNotification(
	token: string,
	title: string,
	body: string,
	data: Record<string, string> = {},
): Promise<void> {
	const fcmToken = rawFcmToken(token);
	if (env.FIREBASE_SERVICE_ACCOUNT) {
		const account = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT) as {
			project_id: string;
			client_email: string;
			private_key: string;
		};
		const now = Math.floor(Date.now() / 1000);
		const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
		const payload = base64Url(
			JSON.stringify({
				iss: account.client_email,
				scope: "https://www.googleapis.com/auth/firebase.messaging",
				aud: "https://oauth2.googleapis.com/token",
				exp: now + 3600,
				iat: now,
			}),
		);
		const signer = createSign("RSA-SHA256");
		signer.update(`${header}.${payload}`);
		const assertion = `${header}.${payload}.${signer.sign(account.private_key, "base64url")}`;
		const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
				assertion,
			}),
		});
		if (!tokenResponse.ok)
			throw new Error(
				`Google OAuth token returned HTTP ${tokenResponse.status}`,
			);
		const auth = (await tokenResponse.json()) as { access_token: string };
		const response = await fetch(
			`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`,
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${auth.access_token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					message: {
						token: fcmToken,
						notification: { title, body },
						data,
						webpush: {
							headers: { Urgency: "high" },
							notification: {
								title,
								body,
								icon: "/favicon.ico",
								requireInteraction: true,
							},
						},
					},
				}),
			},
		);
		if (!response.ok)
			throw new Error(`FCM v1 returned HTTP ${response.status}`);
		return;
	}
	if (env.FIREBASE_SERVER_KEY) {
		const response = await fetch("https://fcm.googleapis.com/fcm/send", {
			method: "POST",
			headers: {
				Authorization: `key=${env.FIREBASE_SERVER_KEY}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				to: fcmToken,
				notification: { title, body },
				data,
			}),
		});
		if (!response.ok)
			throw new Error(`FCM legacy returned HTTP ${response.status}`);
		return;
	}
	throw new Error("Firebase credentials are not configured");
}
