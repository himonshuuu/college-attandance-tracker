import type { Session } from "../modules/auth/session";

declare global {
  namespace Express {
    interface Request {
      session?: Session;
      requestId?: string;
    }
  }
}

export {};
