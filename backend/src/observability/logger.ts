import { env } from "../config/env";

export type LogLevel = "silent" | "error" | "warn" | "info" | "debug";
const weights: Record<LogLevel, number> = {
	silent: 99,
	error: 40,
	warn: 30,
	info: 20,
	debug: 10,
};

export function log(
	level: Exclude<LogLevel, "silent">,
	event: string,
	fields: Record<string, unknown> = {},
): void {
	if (weights[level] < weights[env.LOG_LEVEL]) return;
	console.log(
		JSON.stringify({
			timestamp: new Date().toISOString(),
			level,
			event,
			...fields,
		}),
	);
}
