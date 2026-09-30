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
	value: string;
	/** Comma-split course entries, e.g. ["COMPUTER SCIENCE", "STATISTICS", ...]. */
	courses: string[];
}

export interface CollegeSession {
	sessionId: string;
	obtainedAt: number;
}
