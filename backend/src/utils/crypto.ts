import {
	createHash,
	randomBytes,
	pbkdf2Sync,
	timingSafeEqual,
} from "node:crypto";

const ITERATIONS = 100_000;
const KEY_LENGTH = 64;
const DIGEST = "sha256";

// Compatible with the Worker implementation: saltHex:derivedKeyHex.
export function hashPassword(password: string): string {
	const salt = randomBytes(16);
	const derived = pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, DIGEST);
	return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
	const [saltHex, hashHex] = stored.split(":");
	if (
		!saltHex ||
		!hashHex ||
		!/^[0-9a-f]+$/i.test(saltHex) ||
		!/^[0-9a-f]+$/i.test(hashHex)
	)
		return false;
	const expected = Buffer.from(hashHex, "hex");
	const actual = pbkdf2Sync(
		password,
		Buffer.from(saltHex, "hex"),
		ITERATIONS,
		expected.length,
		DIGEST,
	);
	return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function generateToken(): string {
	return randomBytes(32).toString("hex");
}

export function sha256Hex(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}
