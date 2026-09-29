import { CollegePortalError } from "./college.errors";
import type { StudentProfile } from "./college.types";

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
	};
}
