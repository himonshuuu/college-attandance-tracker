import type { Session } from "../middleware/session";

declare global {
	namespace Express {
		interface Request {
			session?: Session;
			requestId?: string;
		}
	}
}

export {};
