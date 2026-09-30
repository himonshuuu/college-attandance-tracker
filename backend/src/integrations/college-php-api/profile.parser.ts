import { CollegePortalError } from "./college.errors";
import type { StudentProfile, SubjectDetail } from "./college.types";

function profileCellText(value: string): string {
	return value
		.replace(/<br\s*\/?>(\s*)/gi, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/&quot;/gi, '"')
		.replace(/&#39;|&apos;/gi, "'")
		.replace(/\s+/g, " ")
		.trim();
}

function profileLabel(value: string): string {
	return profileCellText(value)
		.toLocaleLowerCase("en-US")
		.replace(/[^a-z]/g, "");
}

function splitCourses(value: string): string[] {
	const courses: string[] = [];
	for (const chunk of value.split(",")) {
		const cleaned = chunk.replace(/\s+/g, " ").trim();
		if (!cleaned) continue;
		for (const part of splitGluedSubjects(cleaned)) {
			const name = cleanCourseName(part);
			if (name) courses.push(name);
		}
	}
	return courses;
}

// "NATURAL RESOURCE MANAGEMENT (ZOO-GEC-01)(MINOR)" -> "Natural Resource Management"
// Codes in parentheses are portal metadata, not part of the subject name.
function cleanCourseName(raw: string): string {
	return raw
		.replace(/\([^()]*\)/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.toLowerCase()
		.replace(/\b\w/g, (c) => c.toUpperCase());
}

// The portal sometimes concatenates two subjects with no separator at all
// ("COMPUTER SCIENCESTATISTICS"). There is no case/punctuation boundary to
// split on, so match against known subject names. Add names here as new
// glued pairs are spotted on real pages.
const KNOWN_SUBJECTS = [
	"COMPUTER SCIENCE",
	"STATISTICS",
	"MATHEMATICS",
	"NATURAL RESOURCE MANAGEMENT",
	"ELECTRICAL WIRING AND MAINTENANCE",
	"POLITICAL SCIENCE",
	"PHYSICS",
	"CHEMISTRY",
	"BOTANY",
	"ZOOLOGY",
	"ECONOMICS",
	"HISTORY",
	"GEOGRAPHY",
	"PHILOSOPHY",
	"EDUCATION",
	"SOCIOLOGY",
	"ENGLISH",
	"ASSAMESE",
	"HINDI",
	"BENGALI",
	"SANSKRIT",
].sort((a, b) => b.length - a.length);

function splitGluedSubjects(chunk: string): string[] {
	const pattern = new RegExp(
		KNOWN_SUBJECTS.map((name) =>
			name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
		).join("|"),
		"gi",
	);
	const matched: string[] = [];
	let match: RegExpExecArray | null;
	pattern.lastIndex = 0;
	while ((match = pattern.exec(chunk)) !== null)
		matched.push(match[0].toUpperCase());
	// Only split when the whole chunk is covered by 2+ known names —
	// otherwise keep it untouched instead of mangling unknown subjects.
	if (matched.length < 2) return [chunk];
	const covered = matched.join("").replace(/\s+/g, "");
	if (covered !== chunk.replace(/\s+/g, "").toUpperCase()) return [chunk];
	return matched.map((name) =>
		name.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()),
	);
}

// Reads the "Subject Details" w3-card: rows shaped like
// `<div class="w3-row"><span class="label ...">MAJOR : </span> &nbsp;&nbsp;COMPUTER SCIENCE, ...</div>`
// Labels vary (MAJOR / MINOR / SEC / VAC / AEC), so every `LABEL :` span
// inside the card starts a new entry. The value always ends at the row's
// closing </div> — without this bound, the capture swallows all following
// cards on the page (Personal Details, Contact Details, ...).
export function parseSubjectDetails(html: string): SubjectDetail[] {
	const cardIndex = html.search(/subject\s+details/i);
	if (cardIndex < 0) return [];
	const section = html.slice(cardIndex, cardIndex + 20000);
	const labelPattern =
		/<span\b[^>]*>([^<>]*?:)\s*<\/span\s*>([\s\S]*?)(?=<\/div\s*>|<span\b[^>]*>[^<>]*?:\s*<\/span\s*>|$)/gi;
	const subjects: SubjectDetail[] = [];
	for (const match of section.matchAll(labelPattern)) {
		const label = profileCellText(match[1]).replace(/:$/, "").trim();
		const value = profileCellText(match[2]);
		if (!label || !value) continue;
		subjects.push({ label, value, courses: splitCourses(value) });
	}
	return subjects;
}

export function parseStudentProfile(
	html: string,
	profileUrl: string,
): StudentProfile {
	const values = new Map<string, string>();
	const rows = html.match(/<tr\b[^>]*>[\s\S]*?<\/tr\s*>/gi) ?? [];
	for (const row of rows) {
		const cells = [
			...row.matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)\s*>/gi),
		].map((match) => profileCellText(match[1]));
		if (cells.length < 2) continue;
		const value = cells
			.slice(1)
			.reverse()
			.find((cell) => cell.length > 0 && cell !== ":");
		if (value) values.set(profileLabel(cells[0]), value);
	}
	const name = values.get("name");
	if (!name)
		throw new CollegePortalError(
			"College profile page did not contain a name.",
			"parse",
		);

	const imageSources = [
		...html.matchAll(/<img\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1/gi),
	].map((match) => match[2]);
	const imageSource = imageSources.find((source) =>
		/(?:^|[\\/])profile[\\/]/i.test(source),
	);
	let profilePhotoUrl = "";
	if (imageSource) {
		try {
			const url = new URL(imageSource, profileUrl);
			if (url.protocol === "http:" || url.protocol === "https:")
				profilePhotoUrl = url.toString();
		} catch {
			// A malformed photo URL should not block registration.
		}
	}
	return {
		name,
		className: values.get("class") ?? "",
		stream: values.get("stream") ?? "",
		rollNumber: values.get("rollno") ?? "",
		profilePhotoUrl,
		subjects: parseSubjectDetails(html),
	};
}
