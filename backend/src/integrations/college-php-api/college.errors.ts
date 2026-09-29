export class CollegePortalError extends Error {
	constructor(
		message: string,
		public readonly kind: "config" | "login" | "session" | "network" | "parse",
	) {
		super(message);
		this.name = "CollegePortalError";
	}
}
