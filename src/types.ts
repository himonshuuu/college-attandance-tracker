export const TIME_ZONE = "Asia/Kolkata";

export type AttendanceStatus = "Present" | "Absent";

export interface Env {
  DB: D1Database;
  COLLEGE_LOGIN_URL: string;
  COLLEGE_LOGIN_REFERER: string;
  COLLEGE_PROFILE_URL: string;
  COLLEGE_ATTENDANCE_URL: string;
  COLLEGE_ORIGIN: string;
  COLLEGE_REFERER: string;
  DISCORD_WEBHOOK_URL: string;
  RESEND_API_KEY: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_PUBLIC_KEY?: string;
  FIREBASE_SERVICE_ACCOUNT?: string;
  FIREBASE_SERVER_KEY?: string;
  FIREBASE_VAPID_KEY?: string;
  FIREBASE_PROJECT_ID?: string;
  FIREBASE_API_KEY?: string;
  FIREBASE_APP_ID?: string;
}

export interface User {
  id: number;
  email: string;
  password_hash: string;
  enrollment_id: string;
  name: string;
  className: string;
  stream: string;
  rollNumber: string;
  profilePhotoUrl: string;
  active: boolean;
  created_at: string;
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

export interface CollegeSession {
  sessionId: string;
  obtainedAt: number;
}

export interface StudentProfile {
  name: string;
  className: string;
  stream: string;
  rollNumber: string;
  profilePhotoUrl: string;
}

export interface MonitorAction {
  subject: string;
  action: string;
  status?: string;
  attempt?: number;
  error?: string;
  studentId?: number;
  studentName?: string;
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
  studentsProcessed: number;
  students: StudentMonitorSummary[];
  ignored?: string;
}

export interface StudentMonitorSummary {
  id: number;
  name: string;
  success: boolean;
  recordsFound: number;
  classesChecked: number;
  timetableEntries: number;
  actions: MonitorAction[];
  ignored?: string;
}
