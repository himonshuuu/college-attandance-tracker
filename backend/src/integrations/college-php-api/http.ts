import { CollegePortalError } from "./college.errors";
import type { CollegeSession } from "./college.types";

export const BROWSER_USER_AGENT =
	"Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

const BLOCK_MARKERS = [
	"just a moment",
	"attention required",
	"verify you are human",
	"captcha",
	"recaptcha",
	"access denied",
	"request blocked",
	"blocked by",
	"mod_security",
	"sucuri",
	"ddos protection",
	"cloudflare ray",
	"403 forbidden",
	"too many requests",
];

const LOGIN_MARKERS = [
	'name="phno"',
	"name='phno'",
	'name="pass"',
	"name='pass'",
	'type="password"',
];

export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function browserHeaders(
	extra: Record<string, string> = {},
): Record<string, string> {
	return {
		"User-Agent": BROWSER_USER_AGENT,
		"Accept-Language": "en-US,en;q=0.9",
		...extra,
	};
}

export function looksLikeBlockPage(html: string): boolean {
	const lower = html.toLowerCase();
	return BLOCK_MARKERS.some((marker) => lower.includes(marker));
}

export function looksLikeLoginPage(html: string): boolean {
	const lower = html.toLowerCase();
	return LOGIN_MARKERS.some((marker) => lower.includes(marker));
}

export async function fetchWithRetry(
	url: string,
	init: RequestInit,
): Promise<Response> {
	const transientStatuses = new Set([408, 425, 429, 502, 503, 504]);
	for (let attempt = 0; attempt < 4; attempt++) {
		try {
			const response = await fetch(url, init);
			if (!transientStatuses.has(response.status) || attempt === 3)
				return response;
			await response.arrayBuffer().catch(() => undefined);
			await sleep(800 * 2 ** attempt + Math.random() * 500);
		} catch (error) {
			if (attempt === 3) throw error;
			await sleep(600 * 2 ** attempt + Math.random() * 400);
		}
	}
	throw new CollegePortalError("College portal request failed.", "network");
}

export function extractSessionId(response: Response): string | null {
	const headers = response.headers as Headers & {
		getSetCookie?: () => string[];
	};
	const cookies =
		typeof headers.getSetCookie === "function"
			? headers.getSetCookie()
			: [response.headers.get("set-cookie") ?? ""];
	const match = cookies.join(", ").match(/(?:^|,\s*)PHPSESSID=([^;,\s]+)/i);
	return match?.[1] ?? null;
}

export function assertNotBlockedOrLogin(html: string): void {
	if (looksLikeBlockPage(html))
		throw new CollegePortalError(
			"College portal is rate-limiting requests.",
			"network",
		);
	if (looksLikeLoginPage(html))
		throw new CollegePortalError("College session expired.", "session");
}

export type { CollegeSession };
