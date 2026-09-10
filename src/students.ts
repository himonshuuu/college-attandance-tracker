import { fetchStudentProfile, isCollegeAuthError, CollegeRequestError } from "./college/api";
import type { Env, User, StudentProfile } from "./types";

interface UserRow {
  id: number;
  name: string;
  enrollment_id: string;
  class_name: string;
  stream: string;
  roll_number: string;
  profile_photo_url: string;
  active: number;
}

export type StudentRegistrationErrorKind = "invalid" | "duplicate" | "verification";

export class StudentRegistrationError extends Error {
  constructor(public readonly kind: StudentRegistrationErrorKind) {
    super(
      kind === "duplicate"
        ? "Student is already registered."
        : kind === "verification"
          ? "The ENROLLMENT_ID could not be verified."
          : "Student details are invalid.",
    );
    this.name = "StudentRegistrationError";
  }
}

function cleanRegistrationValue(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > maxLength || /[\u0000-\u001f\u007f]/.test(cleaned)) return null;
  return cleaned;
}

function errorLabel(error: unknown): string {
  if (isCollegeAuthError(error)) return error.kind;
  if (error instanceof CollegeRequestError) return error.kind;
  return "unknown";
}

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    email: "",
    password_hash: "",
    enrollment_id: row.enrollment_id,
    name: row.name,
    className: row.class_name,
    stream: row.stream,
    rollNumber: row.roll_number,
    profilePhotoUrl: row.profile_photo_url,
    active: row.active === 1,
    created_at: "",
  };
}

export async function findStudentByEnrollmentId(env: Env, enrollmentId: string): Promise<User | null> {
  const row = await env.DB.prepare(
    `SELECT id, name, enrollment_id, class_name, stream, roll_number, profile_photo_url, active
     FROM users WHERE enrollment_id = ?`,
  ).bind(enrollmentId).first<UserRow>();
  if (!row) return null;
  return rowToUser(row);
}

export async function listActiveStudents(env: Env): Promise<User[]> {
  try {
    const result = await env.DB.prepare(
      `SELECT id, name, enrollment_id, class_name, stream, roll_number, profile_photo_url, active
       FROM users WHERE active = 1 ORDER BY id`,
    ).all<UserRow>();
    return result.results.map(rowToUser);
  } catch {
    throw new Error("Student records could not be read.");
  }
}

export async function upsertStudent(env: Env, enrollmentId: string, profile: StudentProfile): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO users (enrollment_id, name, class_name, stream, roll_number, profile_photo_url)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(enrollment_id) DO UPDATE SET
       name = excluded.name, class_name = excluded.class_name, stream = excluded.stream,
       roll_number = excluded.roll_number, profile_photo_url = excluded.profile_photo_url`
  ).bind(enrollmentId, profile.name, profile.className, profile.stream, profile.rollNumber, profile.profilePhotoUrl).run();
}
