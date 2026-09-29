import { findUserByEnrollment } from "../users/users.repository";

export class ProfileError extends Error {
	constructor(
		message: string,
		public readonly status: number,
	) {
		super(message);
		this.name = "ProfileError";
	}
}

export async function getProfile(enrollmentId: string) {
	const user = await findUserByEnrollment(enrollmentId);
	if (!user) throw new ProfileError("User not found", 404);
	return {
		user: {
			email: user.email,
			enrollmentId: user.enrollment_id,
			joinedAt: user.created_at,
		},
		profile: {
			name: user.name,
			className: user.class_name,
			stream: user.stream,
			rollNumber: user.roll_number,
			profilePhotoUrl: user.profile_photo_url,
		},
	};
}
