import { fetchAttendance, CollegeRequestError } from "../college/api";
import { CollegeAuthError } from "../college/auth";
import { notifyStudent, notifyAuthError, notifyNotUpdated } from "../notify/notify";
import {
  clearAuthError,
  classInstanceKey,
  learnTimetable,
  loadClassState,
  markAuthErrorNotified,
  newClassState,
  readAuthErrorState,
  saveClassState,
  setFinalState,
} from "./state";
import type {
  AttendanceRecord,
  ClassState,
  Env,
  IndiaDateTime,
  MonitorAction,
  MonitorSummary,
  User,
  StudentMonitorSummary,
  TimetableEntry,
} from "../types";
import { listActiveStudents } from "../students";
import { getIndiaDateTime, minuteOfDay, normalizeKey } from "../time";

const FIRST_CLASS_END = 9 * 60 + 15;
const LAST_CLASS_END = 16 * 60 + 15;
const FINAL_RETRY_TIME = LAST_CLASS_END + 30;

export function dueAttempt(
  entry: Pick<TimetableEntry, "endTime">,
  currentMinute: number,
): { attempt: number; offset: number } | null {
  const end = minuteOfDay(entry.endTime);
  const offset = currentMinute - end;
  if (offset === 0) return { attempt: 1, offset };
  if (offset === 15) return { attempt: 2, offset };
  if (offset === 30) return { attempt: 3, offset };
  return null;
}

function safeErrorLabel(error: unknown): string {
  if (error instanceof CollegeAuthError) return "college-session";
  if (error instanceof CollegeRequestError) return "college-request";
  return "monitor-error";
}

function logError(event: string, error: unknown): void {
  // Never log exception messages: third-party runtimes can include request URLs
  // or header material in their messages.
  console.error(JSON.stringify({ event, error: safeErrorLabel(error) }));
}

function findMatchingRecord(
  records: AttendanceRecord[],
  date: string,
  entry: TimetableEntry,
): AttendanceRecord | undefined {
  const subject = normalizeKey(entry.subject);
  const teacher = normalizeKey(entry.teacher);
  const subjectType = normalizeKey(entry.subjectType);

  return records.find(
    (record) =>
      record.date === date &&
      normalizeKey(record.subject) === subject &&
      normalizeKey(record.teacher) === teacher &&
      record.startTime === entry.startTime &&
      record.endTime === entry.endTime &&
      (!subjectType || normalizeKey(record.subjectType) === subjectType),
  );
}

function slotKey(date: string, currentMinute: number): string {
  return `${date}|${currentMinute.toString().padStart(4, "0")}`;
}

function summaryBase(now: IndiaDateTime): MonitorSummary {
  return {
    success: true,
    indiaTime: now.time,
    date: now.date,
    weekday: now.weekday,
    recordsFound: 0,
    classesChecked: 0,
    timetableEntries: 0,
    actions: [],
    studentsProcessed: 0,
    students: [],
  };
}

async function processClass(
  env: Env,
  student: User,
  entry: TimetableEntry,
  record: AttendanceRecord | undefined,
  now: IndiaDateTime,
  attempt: { attempt: number; offset: number },
  actions: MonitorAction[],
): Promise<void> {
  const classKey = classInstanceKey(
    now.date,
    entry.subject,
    entry.teacher,
    entry.startTime,
    entry.endTime,
  );
  const existing = await loadClassState(env, student.id, classKey);
  const state = existing ?? newClassState(classKey, now.date);
  const slot = slotKey(now.date, now.hour * 60 + now.minute);

  if (state.completed) return;
  if (state.lastAttemptSlot === slot) {
    actions.push({ subject: entry.subject, action: "already-attempted", attempt: attempt.attempt });
    return;
  }

  // Write the attempt marker before doing network work. This prevents a second
  // invocation in the same cron slot from making another attendance attempt.
  const attemptState: ClassState = {
    ...state,
    attempts: Math.max(state.attempts, attempt.attempt),
    lastAttemptSlot: slot,
    lastAttemptAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveClassState(env, student.id, attemptState);

  if (record) {
    if (record.status === "Present" || record.status === "Absent") {
      try {
        await notifyStudent(env, student, record);
        await saveClassState(env, student.id, setFinalState(attemptState, record.status, true));
        actions.push({
          subject: entry.subject,
          action: "notified",
          status: record.status,
          attempt: attempt.attempt,
        });
      } catch (error) {
        logError("notification-error", error);
        actions.push({
          subject: entry.subject,
          action: "notification-error",
          status: record.status,
          attempt: attempt.attempt,
          error: "Notification failed",
        });
      }
      return;
    }

    // A row exists, so it is not a missing-record retry. Preserve the exact
    // status for diagnosis and finish this class instance.
    await saveClassState(env, student.id, setFinalState(attemptState, record.rawStatus, false));
    actions.push({
      subject: entry.subject,
      action: "unexpected-status",
      status: record.rawStatus || "(empty)",
      attempt: attempt.attempt,
    });
    return;
  }

  if (attempt.attempt === 3) {
    try {
      await notifyNotUpdated(env, student, {
        subject: entry.subject,
        teacher: entry.teacher,
        date: now.date,
      });
      await saveClassState(env, student.id, setFinalState(attemptState, "Not updated", true));
      actions.push({
        subject: entry.subject,
        action: "not-updated-warning",
        attempt: attempt.attempt,
      });
    } catch (error) {
      logError("notification-error", error);
      actions.push({
        subject: entry.subject,
        action: "notification-error",
        attempt: attempt.attempt,
        error: "Notification failed",
      });
    }
    return;
  }

  await saveClassState(env, student.id, attemptState);
  actions.push({ subject: entry.subject, action: "retry-scheduled", attempt: attempt.attempt });
}

export async function runMonitorCycle(env: Env, now = new Date()): Promise<MonitorSummary> {
  const india = getIndiaDateTime(now);
  const summary = summaryBase(india);

  if (india.weekday === "Sunday") {
    summary.ignored = "Sunday is not monitored.";
    return summary;
  }

  let students: User[];
  try {
    students = await listActiveStudents(env);
  } catch (error) {
    summary.success = false;
    summary.ignored = "Student records could not be read.";
    logError("student-records", error);
    return summary;
  }

  if (students.length === 0) {
    summary.ignored = "No active students are configured.";
    return summary;
  }

  for (const student of students) {
    const studentSummary = await runStudentMonitorCycle(env, student, india);
    summary.students.push(studentSummary);
    summary.studentsProcessed += 1;
    summary.success = summary.success && studentSummary.success;
    summary.recordsFound += studentSummary.recordsFound;
    summary.classesChecked += studentSummary.classesChecked;
    summary.timetableEntries += studentSummary.timetableEntries;
    summary.actions.push(
      ...studentSummary.actions.map((action) => ({
        ...action,
        studentId: student.id,
        studentName: student.name,
      })),
    );
  }

  return summary;
}

async function runStudentMonitorCycle(
  env: Env,
  student: User,
  india: IndiaDateTime,
): Promise<StudentMonitorSummary> {
  const summary: StudentMonitorSummary = {
    id: student.id,
    name: student.name,
    success: true,
    recordsFound: 0,
    classesChecked: 0,
    timetableEntries: 0,
    actions: [],
  };

  let records: AttendanceRecord[];
  try {
    records = await fetchAttendance(env, student.enrollment_id, india.year, india.monthName);
  } catch (error) {
    if (error instanceof CollegeAuthError) {
      try {
        if (!(await readAuthErrorState(env, student.id))) {
          await notifyAuthError(env, student);
          await markAuthErrorNotified(env, student.id);
        }
      } catch (notificationError) {
        logError("notification-error", notificationError);
      }
      summary.success = false;
      summary.ignored = "College session is not valid.";
      logError("college-session", error);
      return summary;
    }
    summary.success = false;
    summary.ignored = "College attendance request failed.";
    logError("college-request", error);
    return summary;
  }

  try {
    await clearAuthError(env, student.id);
  } catch (error) {
    summary.success = false;
    summary.ignored = "Authentication state could not be updated.";
    logError("auth-state-clear", error);
    return summary;
  }

  summary.recordsFound = records.length;
  let timetable;
  try {
    timetable = await learnTimetable(env, student.id, records);
  } catch (error) {
    summary.success = false;
    summary.ignored = "Timetable state could not be updated.";
    logError("timetable-state", error);
    return summary;
  }
  summary.timetableEntries = timetable.entries.length;

  const currentMinute = india.hour * 60 + india.minute;
  const canCheckClasses = currentMinute >= FIRST_CLASS_END && currentMinute <= FINAL_RETRY_TIME;
  if (!canCheckClasses) {
    summary.ignored = "Outside the attendance check window.";
    return summary;
  }

  const dueEntries = timetable.entries.filter((entry) => {
    if (entry.weekday !== india.weekday) return false;
    const end = minuteOfDay(entry.endTime);
    if (end < FIRST_CLASS_END || end > LAST_CLASS_END) return false;
    return dueAttempt(entry, currentMinute) !== null;
  });

  const uniqueEntries = new Map(
    dueEntries.map((entry) => [
      classInstanceKey(india.date, entry.subject, entry.teacher, entry.startTime, entry.endTime),
      entry,
    ]),
  );

  for (const entry of uniqueEntries.values()) {
    const attempt = dueAttempt(entry, currentMinute);
    if (!attempt) continue;
    summary.classesChecked += 1;
    await processClass(
      env,
      student,
      entry,
      findMatchingRecord(records, india.date, entry),
      india,
      attempt,
      summary.actions,
    );
  }

  return summary;
}
