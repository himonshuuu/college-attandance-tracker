import type {
  AttendanceRecord,
  AttendanceStatus,
  ClassState,
  Env,
  TimetableEntry,
  TimetableState,
} from "../types";
import { normalizeKey, weekdayFromIsoDate } from "../time";

export const AUTH_ERROR_KEY = "authentication-error";

function studentStateKey(studentId: number, key: string): string {
  return `student:${studentId}:${key}`;
}

function classIdentityPart(value: string): string {
  return normalizeKey(value).replace(/[|]/g, " ");
}

export function timetableEntryKey(entry: TimetableEntry): string {
  return [
    entry.weekday, entry.subject, entry.teacher, entry.subjectType, entry.startTime, entry.endTime,
  ].map(classIdentityPart).join("|");
}

export function classInstanceKey(
  date: string, subject: string, teacher: string, startTime: string, endTime: string,
): string {
  return [date, subject, teacher, startTime, endTime].map(classIdentityPart).join("|");
}

function classStateKey(studentId: number, classKey: string): string {
  return studentStateKey(studentId, `class:${encodeURIComponent(classKey)}`);
}

// --- KV-style state stored in D1 via a key-value approach using sessions-like table ---
// We reuse a simple `state_store` approach: a table for monitoring state.
// But since we don't have a generic KV table, we'll store state as JSON in D1
// using a dedicated table. For simplicity, we use a `monitor_state` table.

// Actually, let's keep it simple: store monitoring state in D1 with a `monitor_state` table.
// We need to add this to the migration. For now, we'll create it inline.

async function readJson<T>(env: Env, key: string): Promise<T | null> {
  try {
    const row = await env.DB.prepare(`SELECT value FROM monitor_state WHERE key = ?`).bind(key).first<{ value: string }>();
    if (!row) return null;
    return JSON.parse(row.value) as T;
  } catch { return null; }
}

async function writeJson(env: Env, key: string, value: unknown): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO monitor_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).bind(key, JSON.stringify(value)).run();
}

export async function readAuthErrorState(env: Env, studentId: number): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT value FROM monitor_state WHERE key = ?`
  ).bind(studentStateKey(studentId, AUTH_ERROR_KEY)).first<{ value: string }>();
  return row?.value === "notified";
}

export async function markAuthErrorNotified(env: Env, studentId: number): Promise<void> {
  await writeJson(env, studentStateKey(studentId, AUTH_ERROR_KEY), "notified");
}

export async function clearAuthError(env: Env, studentId: number): Promise<void> {
  await env.DB.prepare(`DELETE FROM monitor_state WHERE key = ?`).bind(studentStateKey(studentId, AUTH_ERROR_KEY)).run();
}

export async function loadTimetable(env: Env, studentId: number): Promise<TimetableState> {
  return (
    (await readJson<TimetableState>(env, studentStateKey(studentId, "state:timetable"))) ?? {
      version: 1, updatedAt: new Date(0).toISOString(), entries: [],
    }
  );
}

export async function learnTimetable(
  env: Env, studentId: number, records: AttendanceRecord[],
): Promise<TimetableState> {
  const current = await loadTimetable(env, studentId);
  const byKey = new Map(current.entries.map((entry) => [timetableEntryKey(entry), entry]));
  const now = new Date().toISOString();

  for (const record of records) {
    const weekday = weekdayFromIsoDate(record.date);
    if (weekday === "Sunday") continue;

    const entry: TimetableEntry = {
      weekday, subject: record.subject, teacher: record.teacher, subjectType: record.subjectType,
      className: record.className, stream: record.stream, startTime: record.startTime,
      endTime: record.endTime, learnedFromDate: record.date, updatedAt: now,
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
    version: 1, updatedAt: now,
    entries: [...byKey.values()].sort((a, b) => timetableEntryKey(a).localeCompare(timetableEntryKey(b))),
  };
  await writeJson(env, studentStateKey(studentId, "state:timetable"), state);
  return state;
}

export async function loadClassState(env: Env, studentId: number, classKey: string): Promise<ClassState | null> {
  return readJson<ClassState>(env, classStateKey(studentId, classKey));
}

export async function saveClassState(env: Env, studentId: number, state: ClassState): Promise<void> {
  await writeJson(env, classStateKey(studentId, state.classKey), state);
}

export function newClassState(classKey: string, date: string): ClassState {
  return {
    version: 1, classKey, date, attempts: 0, lastAttemptSlot: null,
    lastAttemptAt: null, completed: false, notified: false, status: null,
    updatedAt: new Date().toISOString(),
  };
}

export function setFinalState(state: ClassState, status: AttendanceStatus | string, notified: boolean): ClassState {
  return { ...state, completed: true, notified, status, updatedAt: new Date().toISOString() };
}
