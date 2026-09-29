import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import helmet from "helmet";
import { randomUUID } from "node:crypto";
import { env } from "./config/env";
import { sessionMiddleware } from "./middleware/session";
import { attendanceRouter } from "./modules/attendance/attendance.routes";
import { authRouter } from "./modules/auth/auth.routes";
import { engagementRouter } from "./modules/engagement/engagement.routes";
import { friendsRouter } from "./modules/friends/friends.routes";
import { leaderboardRouter } from "./modules/leaderboard/leaderboard.routes";
import { profileRouter } from "./modules/profile/profile.routes";
import { subscriptionsRouter } from "./modules/subscriptions/subscriptions.routes";
import { log } from "./observability/logger";

export const app = express();

app.disable("x-powered-by");
app.use(helmet());
app.use(cors({ origin: env.FRONTEND_ORIGIN, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(cookieParser());
app.use((request, _response, next) => {
	request.requestId = request.header("x-request-id") ?? randomUUID();
	next();
});
app.use(sessionMiddleware);
app.use((request, response, next) => {
	const startedAt = process.hrtime.bigint();
	const requestId = request.requestId ?? randomUUID();
	request.requestId = requestId;
	response.setHeader("x-request-id", requestId);
	response.once("finish", () => {
		const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
		const level =
			response.statusCode >= 500
				? "error"
				: response.statusCode >= 400
					? "warn"
					: durationMs >= 1000
						? "warn"
						: "info";
		log(level, "http-request", {
			requestId,
			method: request.method,
			path: request.path,
			status: response.statusCode,
			durationMs: Math.round(durationMs * 100) / 100,
			authenticated: Boolean(request.session),
		});
	});
	next();
});

app.get("/api/health", (_request, response) =>
	response.json({ ok: true, service: "college-attendance-api" }),
);
app.use("/api/auth", authRouter);
app.use("/api/profile", profileRouter);
app.use("/api/analytics", attendanceRouter);
app.use("/api/leaderboard", leaderboardRouter);
app.use("/api/subscribe", subscriptionsRouter);
app.use("/api/friends", friendsRouter);
app.use("/api/engage", engagementRouter);

app.use((_request, response) =>
	response.status(404).json({ success: false, error: "Not found" }),
);

const errorHandler: ErrorRequestHandler = (error, request, response, _next) => {
	const status = error?.name === "ZodError" ? 400 : 500;
	log("error", "request-error", {
		requestId: request.requestId,
		method: request.method,
		path: request.path,
		status,
		error: error instanceof Error ? error.message : String(error),
	});
	response.status(status).json({
		success: false,
		error: status === 500 ? "Internal server error" : "Invalid request",
		requestId: request.requestId,
	});
};
app.use(errorHandler);
