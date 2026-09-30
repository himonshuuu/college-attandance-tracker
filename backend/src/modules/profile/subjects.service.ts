import { z } from "zod";
import type { SubjectDetail } from "../../integrations/college-php-api";
import { getAllSubjectNames, updateUserSubjects } from "./subjects.repository";

const updateSubjectsSchema = z.object({
	subjects: z
		.array(
			z.object({
				label: z.string().trim().min(1).max(50),
				value: z.string().trim().max(500).optional().default(""),
				courses: z.array(z.string().trim().min(1).max(200)).max(20),
			}),
		)
		.max(10),
});

export async function getSubjectSuggestions(): Promise<string[]> {
	return getAllSubjectNames();
}

export async function saveUserSubjects(
	enrollmentId: string,
	subjects: unknown,
): Promise<void> {
	const parsed: SubjectDetail[] = updateSubjectsSchema.parse(subjects).subjects;
	await updateUserSubjects(enrollmentId, parsed);
}
