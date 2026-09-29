import type {
	AttendanceLike,
	NotificationUser,
} from "../notifications/notification.types";

// Domain events — every event here is a fire-and-forget side effect. If a
// publisher needs a return value (tokens, rows, computed summaries), it must
// stay a direct function call, not an event.
export interface DomainEvents {
	"user.registered": {
		email: string;
		enrollmentId: string;
		requestId?: string;
	};
	"password.reset.requested": {
		email: string;
		resetLink: string;
	};
	"subscriptions.updated": {
		enrollmentId: string;
	};
	"attendance.marked": {
		student: NotificationUser;
		record: AttendanceLike;
	};
	"streak.ended": {
		email: string;
		name: string;
		streak: number;
	};
	"streak.milestone": {
		email: string;
		name: string;
		streak: number;
	};
	"college.auth.failed": {
		student: NotificationUser;
	};
	"attendance.not_updated": {
		student: NotificationUser;
		subject: string;
		teacher: string;
		date: string;
	};
	"digest.weekly": {
		email: string;
		name: string;
		month: string;
		year: number;
		total: number;
		present: number;
		absent: number;
		pct: number;
		bestStreak: number;
		currentStreak: number;
		perfectWeeks: number;
		rankText: string;
		badgeNames: string;
	};
	"rank.changed": {
		email: string;
		name: string;
		from: number;
		to: number;
		total: number;
		movedUp: boolean;
	};
}

export type EventName = keyof DomainEvents;
