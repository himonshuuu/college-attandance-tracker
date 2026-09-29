import { log } from "../../observability/logger";
import type { DomainEvents, EventName } from "./domain.events";

// Tiny typed in-process event bus. Publishers never break because of a
// subscriber: `publish` awaits every handler but never rejects — failures are
// logged with the event name. Request-path publishers should still fire and
// forget (`void publish(...)`); background jobs may `await` it to preserve
// ordering/counting without coupling to the handler implementation.
type Handler<P> = (payload: P) => unknown;

const handlers = new Map<string, Array<Handler<never>>>();

export function subscribe<E extends EventName>(
	name: E,
	handler: (payload: DomainEvents[E]) => unknown,
): void {
	const list = handlers.get(name) ?? [];
	list.push(handler as Handler<never>);
	handlers.set(name, list);
}

export async function publish<E extends EventName>(
	name: E,
	payload: DomainEvents[E],
): Promise<void> {
	const list = handlers.get(name) ?? [];
	if (!list.length) {
		log("warn", "event-unhandled", { event: name });
		return;
	}
	const results = await Promise.allSettled(
		list.map((handler) => handler(payload as never)),
	);
	for (const result of results) {
		if (result.status === "rejected") {
			log("error", "event-handler-failed", {
				event: name,
				error:
					result.reason instanceof Error
						? result.reason.message
						: String(result.reason),
			});
		}
	}
}

export const events = { subscribe, publish };
