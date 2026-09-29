import { log } from "../../observability/logger";
import { fetchStudentAttendance } from "../../integrations/college-php-api";
import type { AttendanceRecord } from "../../integrations/college-php-api";
import {
	readAttendanceCache,
	writeAttendanceCache,
} from "./attendance.repository";

export type { AttendanceRecord };

const MONTHS = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
];

export function currentPeriod(): { year: number; month: string } {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: "Asia/Kolkata",
		year: "numeric",
		month: "long",
	}).formatToParts(new Date());
	return {
		year: Number(parts.find((part) => part.type === "year")?.value),
		month: parts.find((part) => part.type === "month")?.value ?? MONTHS[0],
	};
}

export function resolvePeriod(
	month: string | undefined,
	year: string | undefined,
): { year: number; month: string } {
	const current = currentPeriod();
	const parsedYear = year ? Number(year) : current.year;
	if (
		!Number.isInteger(parsedYear) ||
		parsedYear < 2020 ||
		parsedYear > current.year + 1
	)
		throw new Error("Invalid year.");
	const numeric = month ? Number(month) : NaN;
	const monthName =
		Number.isInteger(numeric) && numeric >= 1 && numeric <= 12
			? MONTHS[numeric - 1]
			: (MONTHS.find(
					(value) => value.toLowerCase() === String(month ?? "").toLowerCase(),
				) ?? (month ? "" : current.month));
	if (!monthName) throw new Error("Invalid month.");
	return { year: parsedYear, month: monthName };
}

export async function getCachedAttendance(
	enrollmentId: string,
	year: number,
	month: string,
	ttlMinutes = 45,
): Promise<AttendanceRecord[]> {
	const cached = await readAttendanceCache(enrollmentId, year, month);
	let stale: AttendanceRecord[] | null = null;
	if (cached) {
		if (Date.now() - cached.fetchedAt < ttlMinutes * 60_000) {
			log("debug", "attendance-cache-hit", {
				year,
				month,
				ttlMinutes,
				recordCount: cached.records.length,
			});
			return cached.records;
		}
		stale = cached.records;
		log("debug", "attendance-cache-stale", {
			year,
			month,
			recordCount: stale.length,
		});
	}

	log("debug", "attendance-cache-refresh", {
		year,
		month,
		hadStaleData: Boolean(stale),
	});
	try {
		const records = await fetchStudentAttendance(enrollmentId, year, month);
		await storeAttendance(enrollmentId, year, month, records);
		log("debug", "attendance-cache-refresh-succeeded", {
			year,
			month,
			recordCount: records.length,
		});
		return records;
	} catch (error) {
		log("warn", "attendance-cache-refresh-failed", {
			year,
			month,
			error: error instanceof Error ? error.message : String(error),
		});
		if (stale) {
			log("warn", "attendance-cache-stale-fallback", {
				year,
				month,
				recordCount: stale.length,
			});
			return stale;
		}
		throw error;
	}
}

export async function storeAttendance(
	enrollmentId: string,
	year: number,
	month: string,
	records: AttendanceRecord[],
): Promise<void> {
	await writeAttendanceCache(enrollmentId, year, month, records);
}

export function summarize(records: AttendanceRecord[]) {
	const total = records.length;
	const present = records.filter(
		(record) => record.status === "Present",
	).length;
	const absent = records.filter((record) => record.status === "Absent").length;
	const subjects = new Map<
		string,
		{ present: number; absent: number; total: number }
	>();
	const daily = new Map<string, { present: number; absent: number }>();
	for (const record of records) {
		const subject = record.subject || "Unknown";
		const subjectEntry = subjects.get(subject) ?? {
			present: 0,
			absent: 0,
			total: 0,
		};
		subjectEntry.total++;
		if (record.status === "Present") subjectEntry.present++;
		if (record.status === "Absent") subjectEntry.absent++;
		subjects.set(subject, subjectEntry);
		const day = daily.get(record.date) ?? { present: 0, absent: 0 };
		if (record.status === "Present") day.present++;
		if (record.status === "Absent") day.absent++;
		daily.set(record.date, day);
	}
	return {
		total,
		present,
		absent,
		pct: total ? Math.round((present / total) * 100) : 0,
		subjects: [...subjects.entries()]
			.map(([name, value]) => ({
				...value,
				name,
				pct: value.total ? Math.round((value.present / value.total) * 100) : 0,
			}))
			.sort((a, b) => a.pct - b.pct),
		daily: [...daily.entries()]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([date, value]) => ({
				...value,
				date,
				pct:
					value.present + value.absent
						? Math.round((value.present / (value.present + value.absent)) * 100)
						: 0,
			})),
	};
}
