import { pool } from "../../db/pool";
import type { SubjectDetail } from "../../integrations/college-php-api";

export async function getAllSubjectNames(): Promise<string[]> {
	const result = await pool.query<{ course: string }>(
		`SELECT DISTINCT jsonb_array_elements_text(subjects->0->'courses') AS course
     FROM users
     WHERE subjects != '[]'::jsonb AND jsonb_array_length(subjects) > 0`,
	);
	return result.rows.map((r) => r.course).sort();
}

export async function updateUserSubjects(
	enrollmentId: string,
	subjects: SubjectDetail[],
): Promise<void> {
	await pool.query(
		`UPDATE users SET subjects = $2::jsonb, updated_at = now() WHERE enrollment_id = $1`,
		[enrollmentId, JSON.stringify(subjects)],
	);
}
