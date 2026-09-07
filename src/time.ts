import { IndiaDateTime, TIME_ZONE, TimeRange } from "./types";

const INDIA_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "long",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const MONTH_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  month: "long",
});

function partsToRecord(parts: Intl.DateTimeFormatPart[]): Record<string, string> {
  return Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

export function getIndiaDateTime(now = new Date()): IndiaDateTime {
  const parts = partsToRecord(INDIA_DATE_FORMATTER.formatToParts(now));
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hour = Number(parts.hour) % 24;
  const minute = Number(parts.minute);

  return {
    date: `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day
      .toString()
      .padStart(2, "0")}`,
    year,
    month,
    monthName: MONTH_FORMATTER.format(now),
    day,
    weekday: parts.weekday,
    hour,
    minute,
    time: `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`,
  };
}

export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeKey(value: string): string {
  return normalizeWhitespace(value).toLocaleLowerCase("en-US");
}

export function formatMinutes(minutes: number): string {
  return `${Math.floor(minutes / 60)
    .toString()
    .padStart(2, "0")}:${(minutes % 60).toString().padStart(2, "0")}`;
}

interface ClockPart {
  hour: number;
  minute: number;
  meridiem: "AM" | "PM" | null;
}

function parseClockPart(value: string): ClockPart | null {
  const match = value
    .trim()
    .match(/^(\d{1,2})\s*(?:[.:]\s*(\d{2}))?\s*(AM|PM)?$/i);
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2] ?? "00");
  if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;

  return {
    hour,
    minute,
    meridiem: match[3] ? (match[3].toUpperCase() as "AM" | "PM") : null,
  };
}

function toMinutes(clock: ClockPart): number {
  if (clock.meridiem === "AM") {
    return (clock.hour === 12 ? 0 : clock.hour) * 60 + clock.minute;
  }
  if (clock.meridiem === "PM") {
    return (clock.hour === 12 ? 12 : clock.hour + 12) * 60 + clock.minute;
  }
  const hour24 = clock.hour >= 1 && clock.hour <= 5 ? clock.hour + 12 : clock.hour;
  return hour24 * 60 + clock.minute;
}

export function normalizeTimeRange(raw: string): TimeRange | null {
  const cleaned = normalizeWhitespace(raw).replace(/[–—]/g, "-");
  const match = cleaned.match(/^(.+?)\s*-\s*(.+?)$/);
  if (!match) return null;

  const start = parseClockPart(match[1]);
  const end = parseClockPart(match[2]);
  if (!start || !end) return null;

  const startMinutes = toMinutes(start);
  let endMinutes = toMinutes(end);

  // This handles a compact period crossing noon such as 12.15-01.15.
  if (!end.meridiem && start.hour === 12 && end.hour <= 5) {
    endMinutes = (end.hour + 12) * 60 + end.minute;
  }

  if (endMinutes <= startMinutes || endMinutes > 24 * 60) return null;

  return {
    startTime: formatMinutes(startMinutes),
    endTime: formatMinutes(endMinutes),
    startMinutes,
    endMinutes,
  };
}

export function parseCollegeDate(raw: string): string | null {
  const value = normalizeWhitespace(raw);
  let day: number;
  let month: number;
  let year: number;

  let match = value.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (match) {
    day = Number(match[1]);
    month = Number(match[2]);
    year = Number(match[3]);
  } else {
    match = value.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
    if (!match) return null;
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day
    .toString()
    .padStart(2, "0")}`;
}

export function weekdayFromIsoDate(date: string): string {
  const value = new Date(`${date}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long" }).format(value);
}

export function minuteOfDay(time: string): number {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}
