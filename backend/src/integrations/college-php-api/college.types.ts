export interface StudentProfile {
	name: string;
	className: string;
	stream: string;
	rollNumber: string;
	profilePhotoUrl: string;
	/** Labelled rows from the "Subject Details" card, e.g. MAJOR / MINOR / SEC / VAC / AEC. */
	subjects: SubjectDetail[];
}

export interface SubjectDetail {
	label: string;
	/** Raw portal text — empty for user-added subjects. */
	value: string;
	courses: string[];
}

export interface CollegeSession {
	sessionId: string;
	obtainedAt: number;
}
