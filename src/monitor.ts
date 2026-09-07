import { fetchAttendance, CollegeRequestError, CollegeSessionError } from "./college";
import {
  notifyAttendance,
  notifyAttendanceNotUpdated,
  notifyAuthenticationError,
  notifyUnexpectedStatus,
} from "./discord";
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
import {
  AttendanceRecord,
  ClassState,
  Env,
  IndiaDateTime,
  MonitorAction,
  MonitorSummary,
  TimetableEntry,
} from "./types";
import { getIndiaDateTime, minuteOfDay, normalizeKey } from "./time";

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
  if (error instanceof CollegeSessionError) return "college-session";
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
  };
}

async function processClass(
  env: Env,
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
  const existing = await loadClassState(env, classKey);
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
  await saveClassState(env, attemptState);

  if (record) {
    if (record.status === "Present" || record.status === "Absent") {
      try {
        await notifyAttendance(env, record);
        await saveClassState(env, setFinalState(attemptState, record.status, true));
        actions.push({
          subject: entry.subject,
          action: "notified",
          status: record.status,
          attempt: attempt.attempt,
        });
      } catch (error) {
        logError("discord-attendance-notification", error);
        actions.push({
          subject: entry.subject,
          action: "notification-error",
          status: record.status,
          attempt: attempt.attempt,
          error: "Discord notification failed",
        });
      }
      return;
    }

    // A row exists, so it is not a missing-record retry. Preserve the exact
    // status for diagnosis and finish this class instance.
    try {
      await notifyUnexpectedStatus(env, record);
    } catch (error) {
      logError("discord-unexpected-status-notification", error);
    }
    await saveClassState(env, setFinalState(attemptState, record.rawStatus, false));
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
      await notifyAttendanceNotUpdated(env, {
        subject: entry.subject,
        teacher: entry.teacher,
        date: now.date,
        expectedTime: entry.endTime,
      });
      await saveClassState(env, setFinalState(attemptState, "Not updated", true));
      actions.push({
        subject: entry.subject,
        action: "not-updated-warning",
        attempt: attempt.attempt,
      });
    } catch (error) {
      logError("discord-not-updated-notification", error);
      actions.push({
        subject: entry.subject,
        action: "notification-error",
        attempt: attempt.attempt,
        error: "Discord notification failed",
      });
    }
    return;
  }

  await saveClassState(env, attemptState);
  actions.push({ subject: entry.subject, action: "retry-scheduled", attempt: attempt.attempt });
}

export async function runMonitorCycle(env: Env, now = new Date()): Promise<MonitorSummary> {
  const india = getIndiaDateTime(now);
  const summary = summaryBase(india);

  if (india.weekday === "Sunday") {
    summary.ignored = "Sunday is not monitored.";
    return summary;
  }

  let records: AttendanceRecord[];
  try {
    records = await fetchAttendance(env, india.year, india.monthName);
  } catch (error) {
    if (error instanceof CollegeSessionError) {
      try {
        if (!(await readAuthErrorState(env))) {
          await notifyAuthenticationError(env);
          await markAuthErrorNotified(env);
        }
      } catch (notificationError) {
        logError("discord-authentication-notification", notificationError);
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
    await clearAuthError(env);
  } catch (error) {
    summary.success = false;
    summary.ignored = "Authentication state could not be updated.";
    logError("auth-state-clear", error);
    return summary;
  }

  summary.recordsFound = records.length;
  let timetable;
  try {
    timetable = await learnTimetable(env, records);
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
      entry,
      findMatchingRecord(records, india.date, entry),
      india,
      attempt,
      summary.actions,
    );
  }

  return summary;
}
