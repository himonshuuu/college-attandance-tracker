export const TIME_ZONE = "Asia/Kolkata";

export type AttendanceStatus = "Present" | "Absent";

export interface Env {
  ATTENDANCE_KV: KVNamespace;
  COLLEGE_PHPSESSID: string;
  COLLEGE_ATTENDANCE_URL: string;
  COLLEGE_ORIGIN: string;
  COLLEGE_REFERER: string;
  DISCORD_WEBHOOK_URL: string;
}

export interface AttendanceRecord {
  date: string;
  className: string;
  stream: string;
  teacher: string;
  subject: string;
  subjectType: string;
  classTiming: string;
  startTime: string;
  endTime: string;
  topic: string;
  rawStatus: string;
  status: AttendanceStatus | null;
}

export interface TimetableEntry {
  weekday: string;
  subject: string;
  teacher: string;
  subjectType: string;
  className: string;
  stream: string;
  startTime: string;
  endTime: string;
  learnedFromDate: string;
  updatedAt: string;
}

export interface TimetableState {
  version: 1;
  updatedAt: string;
  entries: TimetableEntry[];
}

export interface ClassState {
  version: 1;
  classKey: string;
  date: string;
  attempts: number;
  lastAttemptSlot: string | null;
  lastAttemptAt: string | null;
  completed: boolean;
  notified: boolean;
  status: AttendanceStatus | string | null;
  updatedAt: string;
}

export interface MonitorAction {
  subject: string;
  action:
    | "notified"
    | "retry-scheduled"
    | "not-updated-warning"
    | "already-attempted"
    | "unexpected-status"
    | "notification-error";
  status?: string;
  attempt?: number;
  error?: string;
}

export interface MonitorSummary {
  success: boolean;
  indiaTime: string;
  date: string;
  weekday: string;
  recordsFound: number;
  classesChecked: number;
  timetableEntries: number;
  actions: MonitorAction[];
  ignored?: string;
}

export interface IndiaDateTime {
  date: string;
  year: number;
  month: number;
  monthName: string;
  day: number;
  weekday: string;
  hour: number;
  minute: number;
  time: string;
}

export interface TimeRange {
  startTime: string;
  endTime: string;
  startMinutes: number;
  endMinutes: number;
}
