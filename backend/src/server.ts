import { app } from "./app";
import { env } from "./config/env";
import { runMigrations } from "./db/migrations";
import { pool, withTransaction } from "./db/pool";
import { startNotificationScheduler } from "./jobs/notification.scheduler";
import { registerEventHandlers } from "./infrastructure/events/handlers";
import { log } from "./observability/logger";

let server: ReturnType<typeof app.listen>;

async function main(): Promise<void> {
	registerEventHandlers();
	await withTransaction(async (client) => runMigrations(client));
	server = app.listen(env.PORT, () => {
		log("info", "api-started", { port: env.PORT, environment: env.NODE_ENV });
		startNotificationScheduler();
	});
}

async function shutdown(signal: string): Promise<void> {
	log("info", "api-shutdown", { signal });
	server.close(async () => {
		await pool.end();
		process.exit(0);
	});
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

void main().catch((error) => {
	log("error", "api-start-failed", {
		error: error instanceof Error ? error.message : String(error),
	});
	process.exitCode = 1;
});
