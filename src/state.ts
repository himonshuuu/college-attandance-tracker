import {
  AttendanceRecord,
  AttendanceStatus,
  ClassState,
  Env,
  TimetableEntry,
  TimetableState,
} from "./types";
import { normalizeKey, weekdayFromIsoDate } from "./time";

export const AUTH_ERROR_KEY = "state:authentication-error";
const TIMETABLE_KEY = "state:timetable";

function classIdentityPart(value: string): string {
  return normalizeKey(value).replace(/[|]/g, " ");
}

export function timetableEntryKey(entry: TimetableEntry): string {
  return [
    entry.weekday,
    entry.subject,
    entry.teacher,
    entry.subjectType,
    entry.startTime,
    entry.endTime,
  ]
    .map(classIdentityPart)
    .join("|");
}

export function classInstanceKey(
  date: string,
  subject: string,
  teacher: string,
  startTime: string,
  endTime: string,
): string {
  return [date, subject, teacher, startTime, endTime].map(classIdentityPart).join("|");
}

function classStateKey(classKey: string): string {
  return `class:${encodeURIComponent(classKey)}`;
}

async function readJson<T>(env: Env, key: string): Promise<T | null> {
  try {
    return await env.ATTENDANCE_KV.get<T>(key, "json");
  } catch {
    throw new Error("Persistent state could not be read.");
  }
}

async function writeJson(env: Env, key: string, value: unknown): Promise<void> {
  try {
    await env.ATTENDANCE_KV.put(key, JSON.stringify(value));
  } catch {
    throw new Error("Persistent state could not be written.");
  }
}

export async function readAuthErrorState(env: Env): Promise<boolean> {
  try {
    return (await env.ATTENDANCE_KV.get(AUTH_ERROR_KEY)) === "notified";
  } catch {
    throw new Error("Persistent authentication state could not be read.");
  }
}

export async function markAuthErrorNotified(env: Env): Promise<void> {
  try {
    await env.ATTENDANCE_KV.put(AUTH_ERROR_KEY, "notified");
  } catch {
    throw new Error("Persistent authentication state could not be written.");
  }
}

export async function clearAuthError(env: Env): Promise<void> {
  try {
    await env.ATTENDANCE_KV.delete(AUTH_ERROR_KEY);
  } catch {
    throw new Error("Persistent authentication state could not be cleared.");
  }
}

export async function loadTimetable(env: Env): Promise<TimetableState> {
  return (
    (await readJson<TimetableState>(env, TIMETABLE_KEY)) ?? {
      version: 1,
      updatedAt: new Date(0).toISOString(),
      entries: [],
    }
  );
}

export async function learnTimetable(
  env: Env,
  records: AttendanceRecord[],
): Promise<TimetableState> {
  const current = await loadTimetable(env);
  const byKey = new Map(current.entries.map((entry) => [timetableEntryKey(entry), entry]));
  const now = new Date().toISOString();

  for (const record of records) {
    const weekday = weekdayFromIsoDate(record.date);
    if (weekday === "Sunday") continue;

    const entry: TimetableEntry = {
      weekday,
      subject: record.subject,
      teacher: record.teacher,
      subjectType: record.subjectType,
      className: record.className,
      stream: record.stream,
      startTime: record.startTime,
      endTime: record.endTime,
      learnedFromDate: record.date,
      updatedAt: now,
    };
    const key = timetableEntryKey(entry);
    const previous = byKey.get(key);
    byKey.set(key, {
      ...(previous ?? entry),
      className: record.className || previous?.className || "",
      stream: record.stream || previous?.stream || "",
      learnedFromDate: previous?.learnedFromDate ?? record.date,
      updatedAt: now,
    });
  }

  const state: TimetableState = {
    version: 1,
    updatedAt: now,
    entries: [...byKey.values()].sort((a, b) =>
      timetableEntryKey(a).localeCompare(timetableEntryKey(b)),
    ),
  };
  await writeJson(env, TIMETABLE_KEY, state);
  return state;
}

export async function loadClassState(env: Env, classKey: string): Promise<ClassState | null> {
  return readJson<ClassState>(env, classStateKey(classKey));
}

export async function saveClassState(env: Env, state: ClassState): Promise<void> {
  await writeJson(env, classStateKey(state.classKey), state);
}

export function newClassState(classKey: string, date: string): ClassState {
  return {
    version: 1,
    classKey,
    date,
    attempts: 0,
    lastAttemptSlot: null,
    lastAttemptAt: null,
    completed: false,
    notified: false,
    status: null,
    updatedAt: new Date().toISOString(),
  };
}

export function setFinalState(
  state: ClassState,
  status: AttendanceStatus | string,
  notified: boolean,
): ClassState {
  return {
    ...state,
    completed: true,
    notified,
    status,
    updatedAt: new Date().toISOString(),
  };
}
