import { pool } from "../../db/pool";
import type { SubjectDetail } from "../../integrations/college-php-api";

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
	subjects: SubjectDetail[];
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
	subjects?: SubjectDetail[];
}): Promise<UserRecord> {
	const result = await pool.query<UserRecord>(
		`INSERT INTO users
      (email, password_hash, enrollment_id, name, class_name, stream, roll_number, profile_photo_url, subjects)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
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
			JSON.stringify(input.subjects ?? []),
		],
	);
	return result.rows[0];
}

// Refreshes stored portal data (used by registration + the backfill script).
// Subjects replace the old list wholesale; scalar fields update only when
// the portal actually returned a non-empty value.
export async function updateUserProfile(
	enrollmentId: string,
	profile: {
		name: string;
		className: string;
		stream: string;
		rollNumber: string;
		profilePhotoUrl: string;
		subjects: SubjectDetail[];
	},
): Promise<void> {
	await pool.query(
		`UPDATE users SET
       name = CASE WHEN $2 <> '' THEN $2 ELSE name END,
       class_name = CASE WHEN $3 <> '' THEN $3 ELSE class_name END,
       stream = CASE WHEN $4 <> '' THEN $4 ELSE stream END,
       roll_number = CASE WHEN $5 <> '' THEN $5 ELSE roll_number END,
       profile_photo_url = CASE WHEN $6 <> '' THEN $6 ELSE profile_photo_url END,
       subjects = $7::jsonb,
       updated_at = now()
     WHERE enrollment_id = $1`,
		[
			enrollmentId,
			profile.name,
			profile.className,
			profile.stream,
			profile.rollNumber,
			profile.profilePhotoUrl,
			JSON.stringify(profile.subjects),
		],
	);
}
