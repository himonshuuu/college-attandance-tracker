import { env } from "../../config/env";
import { pool } from "../../db/pool";
import { log } from "../../observability/logger";
import { fetchStudentAttendance } from "../college/college.service";
import { storeAttendance } from "../attendance/attendance.service";
import { notifyAuthError, notifyNotUpdated, notifyStudent, sendStreakEmail, type NotificationUser } from "./notification.service";
import type { AttendanceRecord } from "../college/attendance.parser";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const FIRST_CLASS_END = 9 * 60 + 15;
const LAST_CLASS_END = 16 * 60 + 15;
const FINAL_RETRY_TIME = LAST_CLASS_END + 30;

interface TimetableEntry {
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

interface ClassState {
  classKey: string;
  date: string;
  attempts: number;
  lastAttemptSlot: string | null;
  completed: boolean;
  notified: boolean;
  status: string | null;
  updatedAt: string;
}

interface IndiaTime {
  date: string;
  year: number;
  month: number;
  monthName: string;
  weekday: string;
  hour: number;
  minute: number;
}

function indiaTime(now = new Date()): IndiaTime {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", weekday: "long", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, year: Number(parts.year), month: Number(parts.month), monthName: MONTHS[Number(parts.month) - 1], weekday: parts.weekday, hour: Number(parts.hour) % 24, minute: Number(parts.minute) };
}

function normalize(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim().toLocaleLowerCase("en-US");
}

function minutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function classKey(date: string, subject: string, teacher: string, startTime: string, endTime: string): string {
  return [date, subject, teacher, startTime, endTime].map((value) => normalize(value).replace(/[|]/g, " ")).join("|");
}

function stateKey(userId: number, suffix: string): string {
  return `student:${userId}:${suffix}`;
}

async function readState<T>(key: string): Promise<T | null> {
  const result = await pool.query<{ value: string }>("SELECT value FROM monitor_state WHERE key = $1", [key]);
  const value = result.rows[0]?.value;
  if (!value) return null;
  try { return JSON.parse(value) as T; } catch { return null; }
}

async function writeState(key: string, value: unknown): Promise<void> {
  await pool.query("INSERT INTO monitor_state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [key, JSON.stringify(value)]);
}

async function learnTimetable(userId: number, records: AttendanceRecord[]): Promise<TimetableEntry[]> {
  const existing = await readState<{ entries: TimetableEntry[] }>(stateKey(userId, "state:timetable"));
  const byKey = new Map((existing?.entries ?? []).map((entry) => [[entry.weekday, entry.subject, entry.teacher, entry.subjectType, entry.startTime, entry.endTime].map(normalize).join("|"), entry]));
  const now = new Date().toISOString();
  for (const record of records) {
    const date = new Date(`${record.date}T00:00:00Z`);
    const weekday = date.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
    if (weekday === "Sunday" || !record.startTime || !record.endTime) continue;
    const entry: TimetableEntry = { weekday, subject: record.subject ?? "", teacher: record.teacher ?? "", subjectType: record.subjectType ?? "", className: record.className ?? "", stream: record.stream ?? "", startTime: record.startTime, endTime: record.endTime, learnedFromDate: record.date, updatedAt: now };
    const key = [entry.weekday, entry.subject, entry.teacher, entry.subjectType, entry.startTime, entry.endTime].map(normalize).join("|");
    const previous = byKey.get(key);
    byKey.set(key, { ...(previous ?? entry), className: entry.className || previous?.className || "", stream: entry.stream || previous?.stream || "", learnedFromDate: previous?.learnedFromDate ?? entry.learnedFromDate, updatedAt: now });
  }
  const entries = [...byKey.values()].sort((left, right) => `${left.weekday}|${left.subject}|${left.startTime}`.localeCompare(`${right.weekday}|${right.subject}|${right.startTime}`));
  await writeState(stateKey(userId, "state:timetable"), { version: 1, updatedAt: now, entries });
  return entries;
}

function matchingRecord(records: AttendanceRecord[], date: string, entry: TimetableEntry): AttendanceRecord | undefined {
  return records.find((record) => record.date === date && normalize(record.subject) === normalize(entry.subject) && normalize(record.teacher) === normalize(entry.teacher) && record.startTime === entry.startTime && record.endTime === entry.endTime && (!entry.subjectType || normalize(record.subjectType) === normalize(entry.subjectType)));
}

function priorStreak(records: AttendanceRecord[], record: AttendanceRecord): number {
  const rest = records.filter((candidate) => (candidate.status === "Present" || candidate.status === "Absent") && !(candidate.date === record.date && candidate.subject === record.subject && candidate.startTime === record.startTime)).sort((left, right) => `${left.date}${left.startTime ?? ""}`.localeCompare(`${right.date}${right.startTime ?? ""}`));
  let streak = 0;
  for (let index = rest.length - 1; index >= 0; index--) {
    if (rest[index].status === "Present") streak++;
    else break;
  }
  return streak;
}

async function processClass(student: NotificationUser, entry: TimetableEntry, record: AttendanceRecord | undefined, records: AttendanceRecord[], india: IndiaTime, attempt: number): Promise<void> {
  const key = classKey(india.date, entry.subject, entry.teacher, entry.startTime, entry.endTime);
  const current = await readState<ClassState>(stateKey(student.id, `class:${encodeURIComponent(key)}`));
  const state = current ?? { classKey: key, date: india.date, attempts: 0, lastAttemptSlot: null, completed: false, notified: false, status: null, updatedAt: new Date().toISOString() };
  const slot = `${india.date}|${String(india.hour * 60 + india.minute).padStart(4, "0")}`;
  if (state.completed || state.lastAttemptSlot === slot) return;
  const attemptState = { ...state, attempts: Math.max(state.attempts, attempt), lastAttemptSlot: slot, updatedAt: new Date().toISOString() };
  await writeState(stateKey(student.id, `class:${encodeURIComponent(key)}`), attemptState);
  if (record) {
    if (record.status === "Present" || record.status === "Absent") {
      await notifyStudent(student, record);
      await writeState(stateKey(student.id, `class:${encodeURIComponent(key)}`), { ...attemptState, completed: true, notified: true, status: record.status, updatedAt: new Date().toISOString() });
      const prior = priorStreak(records, record);
      if (record.status === "Absent" && prior >= 3) await sendStreakEmail(student.email, student.name, "broken", prior);
      if (record.status === "Present" && (prior + 1 === 5 || prior + 1 === 10)) await sendStreakEmail(student.email, student.name, "milestone", prior + 1);
      return;
    }
    await writeState(stateKey(student.id, `class:${encodeURIComponent(key)}`), { ...attemptState, completed: true, status: record.rawStatus ?? null, updatedAt: new Date().toISOString() });
    return;
  }
  if (attempt === 3) {
    await notifyNotUpdated(student, { subject: entry.subject, teacher: entry.teacher, date: india.date });
    await writeState(stateKey(student.id, `class:${encodeURIComponent(key)}`), { ...attemptState, completed: true, notified: true, status: "Not updated", updatedAt: new Date().toISOString() });
  }
}

async function processStudent(student: NotificationUser, india: IndiaTime): Promise<void> {
  let records: AttendanceRecord[];
  try {
    records = await fetchStudentAttendance(student.enrollment_id, india.year, india.monthName);
    await writeState(stateKey(student.id, "authentication-error"), null);
  } catch (error) {
    const notified = await readState<string>(stateKey(student.id, "authentication-error"));
    if (!notified) {
      try { await notifyAuthError(student); await writeState(stateKey(student.id, "authentication-error"), "notified"); } catch (notificationError) { log("error", "notification-auth-error-failed", { error: notificationError instanceof Error ? notificationError.message : String(notificationError) }); }
    }
    log("warn", "monitor-attendance-fetch-failed", { error: error instanceof Error ? error.message : String(error) });
    return;
  }
  await storeAttendance(student.enrollment_id, india.year, india.monthName, records);
  const timetable = await learnTimetable(student.id, records);
  const currentMinute = india.hour * 60 + india.minute;
  if (currentMinute < FIRST_CLASS_END || currentMinute > FINAL_RETRY_TIME) return;
  for (const entry of timetable.filter((item) => item.weekday === india.weekday && minutes(item.endTime) >= FIRST_CLASS_END && minutes(item.endTime) <= LAST_CLASS_END)) {
    const offset = currentMinute - minutes(entry.endTime);
    if (offset !== 0 && offset !== 15 && offset !== 30) continue;
    await processClass(student, entry, matchingRecord(records, india.date, entry), records, india, offset === 0 ? 1 : offset === 15 ? 2 : 3);
  }
}

export async function runMonitorCycle(now = new Date()): Promise<void> {
  const india = indiaTime(now);
  if (india.weekday === "Sunday") return;
  const result = await pool.query<NotificationUser>("SELECT id, email, enrollment_id, name FROM users WHERE active = TRUE ORDER BY id");
  for (const student of result.rows) {
    try { await processStudent(student, india); } catch (error) { log("error", "monitor-student-failed", { error: error instanceof Error ? error.message : String(error) }); }
  }
  log("info", "notification-monitor-cycle-complete", { students: result.rowCount ?? 0, date: india.date, time: `${india.hour}:${india.minute}` });
}

export function currentIndiaTime(): IndiaTime {
  return indiaTime();
}
