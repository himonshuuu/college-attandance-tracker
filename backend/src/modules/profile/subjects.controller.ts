import type { Request, Response } from "express";
import { getSubjectSuggestions, saveUserSubjects } from "./subjects.service";

export async function getSubjectsHandler(
	_request: Request,
	response: Response,
) {
	return response.json({ subjects: await getSubjectSuggestions() });
}

export async function updateSubjectsHandler(
	request: Request,
	response: Response,
) {
	await saveUserSubjects(request.session!.enrollmentId, request.body?.subjects);
	return response.json({ success: true });
}
