export interface NotificationUser {
	id: number;
	email: string;
	enrollment_id: string;
	name: string;
}

export interface AttendanceLike {
	date: string;
	subject?: string;
	teacher?: string;
	classTiming?: string;
	status?: string | null;
}
