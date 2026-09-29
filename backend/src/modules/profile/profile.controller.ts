import type { Request, Response } from "express";
import { getProfile, ProfileError } from "./profile.service";

export async function getMyProfile(request: Request, response: Response) {
	try {
		return response.json(await getProfile(request.session!.enrollmentId));
	} catch (error) {
		if (error instanceof ProfileError)
			return response.status(error.status).json({ error: error.message });
		throw error;
	}
}
