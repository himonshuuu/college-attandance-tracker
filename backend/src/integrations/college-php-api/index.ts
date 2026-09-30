// Public surface of the college PHP-portal integration.
// App code should import from here — never from client/parser internals directly.
export { CollegePortalError } from "./college.errors";
export type {
	StudentProfile,
	SubjectDetail,
	CollegeSession,
} from "./college.types";
export type { AttendanceRecord } from "./attendance.parser";
export { AttendanceHtmlError, parseAttendanceHtml } from "./attendance.parser";
export { parseStudentProfile, parseSubjectDetails } from "./profile.parser";
export { fetchStudentProfile, fetchStudentAttendance } from "./college.service";
export { getCollegeSession, validateCollegeConfig } from "./college.client";
export {
	getCachedSession,
	cacheSession,
	invalidateSession,
} from "./session.store";
