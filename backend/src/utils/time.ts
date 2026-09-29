export const MONTHS = [
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
] as const;

export type MonthName = (typeof MONTHS)[number];

export function minutesOfDay(value: string): number {
	const [hour, minute] = value.split(":").map(Number);
	return hour * 60 + minute;
}

export function normalizeText(value: string | undefined): string {
	return (value ?? "").replace(/\s+/g, " ").trim().toLocaleLowerCase("en-US");
}
