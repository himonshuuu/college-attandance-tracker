import { pool } from "../../db/pool";

export interface UserRecord {
	id: number;
	email: string;
	password_hash: string;
	enrollment_id: string;
	name: string;
	class_name: string;
	stream: string;
	roll_number: string;
	profile_photo_url: string;
	active: boolean;
	created_at: Date;
}

export async function findUserByEmail(
	email: string,
): Promise<UserRecord | null> {
	const result = await pool.query<UserRecord>(
		"SELECT * FROM users WHERE email = $1",
		[email],
	);
	return result.rows[0] ?? null;
}

export async function findUserByEnrollment(
	enrollmentId: string,
): Promise<UserRecord | null> {
	const result = await pool.query<UserRecord>(
		"SELECT * FROM users WHERE enrollment_id = $1",
		[enrollmentId],
	);
	return result.rows[0] ?? null;
}

export async function findUserById(id: number): Promise<UserRecord | null> {
	const result = await pool.query<UserRecord>(
		"SELECT * FROM users WHERE id = $1",
		[id],
	);
	return result.rows[0] ?? null;
}

export async function createUser(input: {
	email: string;
	passwordHash: string;
	enrollmentId: string;
	name?: string;
	className?: string;
	stream?: string;
	rollNumber?: string;
	profilePhotoUrl?: string;
}): Promise<UserRecord> {
	const result = await pool.query<UserRecord>(
		`INSERT INTO users
      (email, password_hash, enrollment_id, name, class_name, stream, roll_number, profile_photo_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
		[
			input.email,
			input.passwordHash,
			input.enrollmentId,
			input.name ?? "",
			input.className ?? "",
			input.stream ?? "",
			input.rollNumber ?? "",
			input.profilePhotoUrl ?? "",
		],
	);
	return result.rows[0];
}
