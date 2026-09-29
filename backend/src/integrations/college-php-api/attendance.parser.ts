export interface AttendanceRecord {
	date: string;
	className?: string;
	stream?: string;
	teacher?: string;
	subject?: string;
	subjectType?: string;
	classTiming?: string;
	startTime?: string;
	endTime?: string;
	topic?: string;
	rawStatus?: string;
	status?: "Present" | "Absent" | null;
	[key: string]: unknown;
}

export class AttendanceHtmlError extends Error {
	constructor(
		public readonly kind: "missing-table" | "invalid-table",
		message: string,
	) {
		super(message);
		this.name = "AttendanceHtmlError";
	}
}

function normalizeWhitespace(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function decodeEntities(value: string): string {
	const named: Record<string, string> = {
		amp: "&",
		apos: "'",
		gt: ">",
		lt: "<",
		nbsp: " ",
		quot: '"',
	};
	return value
		.replace(/&#x([\da-f]+);/gi, (whole, hex: string) => {
			const codePoint = Number.parseInt(hex, 16);
			return Number.isNaN(codePoint) ? whole : String.fromCodePoint(codePoint);
		})
		.replace(/&#(\d+);/g, (whole, decimal: string) => {
			const codePoint = Number.parseInt(decimal, 10);
			return Number.isNaN(codePoint) ? whole : String.fromCodePoint(codePoint);
		})
		.replace(
			/&([a-z]+);/gi,
			(whole, name: string) => named[name.toLowerCase()] ?? whole,
		);
}

function cellText(html: string): string {
	return normalizeWhitespace(
		decodeEntities(
			html
				.replace(/<!--(?:.|[\r\n])*?-->/g, "")
				.replace(/<br\s*\/?>(\s*)/gi, " ")
				.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
				.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
				.replace(/<[^>]+>/g, " "),
		),
	);
}

function normalizeHeader(value: string): string {
	return cellText(value)
		.toLocaleLowerCase("en-US")
		.replace(/[^a-z0-9]/g, "");
}

function parseCollegeDate(raw: string): string | null {
	const value = normalizeWhitespace(raw);
	const dayFirst = value.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
	const yearFirst = value.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
	if (!dayFirst && !yearFirst) return null;
	const year = Number(dayFirst ? dayFirst[3] : yearFirst![1]);
	const month = Number(dayFirst ? dayFirst[2] : yearFirst![2]);
	const day = Number(dayFirst ? dayFirst[1] : yearFirst![3]);
	const date = new Date(Date.UTC(year, month - 1, day));
	if (
		date.getUTCFullYear() !== year ||
		date.getUTCMonth() !== month - 1 ||
		date.getUTCDate() !== day
	)
		return null;
	return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function normalizeTimeRange(
	raw: string,
): { startTime: string; endTime: string } | null {
	const match = normalizeWhitespace(raw)
		.replace(/[–—]/g, "-")
		.match(/^(.+?)\s*-\s*(.+?)$/);
	if (!match) return null;
	const parseClock = (value: string) => {
		const clock = value
			.trim()
			.match(/^(\d{1,2})\s*(?:[.:]\s*(\d{2}))?\s*(AM|PM)?$/i);
		if (!clock) return null;
		const hour = Number(clock[1]);
		const minute = Number(clock[2] ?? "00");
		if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;
		const meridiem = clock[3]?.toUpperCase();
		const minutes =
			meridiem === "AM"
				? (hour === 12 ? 0 : hour) * 60 + minute
				: meridiem === "PM"
					? (hour === 12 ? 12 : hour + 12) * 60 + minute
					: (hour >= 1 && hour <= 5 ? hour + 12 : hour) * 60 + minute;
		return { hour, minutes };
	};
	const start = parseClock(match[1]);
	const end = parseClock(match[2]);
	if (!start || !end) return null;
	let endMinutes = end.minutes;
	if (
		!match[1].toUpperCase().includes("AM") &&
		!match[1].toUpperCase().includes("PM") &&
		start.hour === 12 &&
		end.hour <= 5
	)
		endMinutes =
			(end.hour + 12) * 60 + Number(match[2].match(/[.:](\d{2})/)?.[1] ?? "0");
	if (endMinutes <= start.minutes || endMinutes > 24 * 60) return null;
	const format = (minutes: number) =>
		`${Math.floor(minutes / 60)
			.toString()
			.padStart(2, "0")}:${(minutes % 60).toString().padStart(2, "0")}`;
	return { startTime: format(start.minutes), endTime: format(endMinutes) };
}

export function parseAttendanceHtml(html: string): AttendanceRecord[] {
	if (!html.trim())
		throw new AttendanceHtmlError(
			"missing-table",
			"Attendance response was empty.",
		);
	const table = html.match(
		/<table\b[^>]*\bid\s*=\s*(?:"TodaysClass"|'TodaysClass'|TodaysClass)[^>]*>[\s\S]*?<\/table\s*>/i,
	)?.[0];
	if (!table)
		throw new AttendanceHtmlError(
			"missing-table",
			"Attendance table was not found.",
		);
	const rows = [...table.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr\s*>/gi)].map(
		(match) => match[0],
	);
	let headerIndex = -1;
	let headers: string[] = [];
	for (let index = 0; index < rows.length; index++) {
		const cells = [
			...rows[index].matchAll(/<(th|td)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi),
		].map((match) => cellText(match[2]));
		const candidate = cells.map(normalizeHeader);
		if (candidate.includes("date") && candidate.includes("status")) {
			headerIndex = index;
			headers = candidate;
			break;
		}
	}
	if (headerIndex < 0)
		throw new AttendanceHtmlError(
			"invalid-table",
			"Attendance table headers were not found.",
		);
	const required = [
		"date",
		"teacher",
		"subject",
		"subjecttype",
		"classtiming",
		"status",
	];
	if (required.some((header) => !headers.includes(header)))
		throw new AttendanceHtmlError(
			"invalid-table",
			"Attendance table is missing required columns.",
		);
	const indexOf = (header: string) => headers.indexOf(header);
	const records: AttendanceRecord[] = [];
	for (const row of rows.slice(headerIndex + 1)) {
		const cells = [
			...row.matchAll(/<(th|td)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi),
		].map((match) => cellText(match[2]));
		if (cells.length < headers.length) continue;
		const values = headers.map((_, index) => cells[index] ?? "");
		const date = parseCollegeDate(values[indexOf("date")]);
		const timing = normalizeTimeRange(values[indexOf("classtiming")]);
		if (!date || !timing) continue;
		const rawStatus = normalizeWhitespace(values[indexOf("status")]);
		const loweredStatus = rawStatus.toLocaleLowerCase("en-US");
		records.push({
			date,
			className: values[indexOf("class")] ?? "",
			stream: values[indexOf("stream")] ?? "",
			teacher: values[indexOf("teacher")] ?? "",
			subject: values[indexOf("subject")] ?? "",
			subjectType: values[indexOf("subjecttype")] ?? "",
			classTiming: `${timing.startTime}-${timing.endTime}`,
			startTime: timing.startTime,
			endTime: timing.endTime,
			topic: values[indexOf("topic")] ?? "",
			rawStatus,
			status:
				loweredStatus === "present"
					? "Present"
					: loweredStatus === "absent"
						? "Absent"
						: null,
		});
	}
	return records;
}
