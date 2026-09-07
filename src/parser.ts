import { AttendanceRecord } from "./types";
import { normalizeTimeRange, normalizeWhitespace, parseCollegeDate } from "./time";

export class AttendanceHtmlError extends Error {
  constructor(public readonly kind: "missing-table" | "invalid-table", message: string) {
    super(message);
    this.name = "AttendanceHtmlError";
  }
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
    .replace(/&([a-z]+);/gi, (whole, name: string) => named[name.toLowerCase()] ?? whole);
}

function cellText(html: string): string {
  return normalizeWhitespace(
    decodeEntities(
      html
        .replace(/<!--(?:.|[\r\n])*?-->/g, "")
        .replace(/<br\s*\/?>/gi, " ")
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " "),
    ),
  );
}

function normalizeHeader(value: string): string {
  return cellText(value).toLocaleLowerCase("en-US").replace(/[^a-z0-9]/g, "");
}

interface ParsedCell {
  tag: "th" | "td";
  value: string;
}

function cellsInRow(row: string): ParsedCell[] {
  const cells: ParsedCell[] = [];
  const expression = /<(th|td)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
  for (const match of row.matchAll(expression)) {
    cells.push({ tag: match[1].toLowerCase() as "th" | "td", value: cellText(match[2]) });
  }
  return cells;
}

function getAttendanceTable(html: string): string {
  const table = html.match(
    /<table\b[^>]*\bid\s*=\s*(?:"TodaysClass"|'TodaysClass'|TodaysClass)[^>]*>[\s\S]*?<\/table\s*>/i,
  );
  if (!table) {
    throw new AttendanceHtmlError("missing-table", "Attendance table was not found.");
  }
  return table[0];
}

export function parseAttendanceHtml(html: string): AttendanceRecord[] {
  if (!html || html.trim().length === 0) {
    throw new AttendanceHtmlError("missing-table", "Attendance response was empty.");
  }

  const table = getAttendanceTable(html);
  const rows = [...table.matchAll(/<tr\b[^>]*>[\s\S]*?<\/tr\s*>/gi)].map((match) => match[0]);
  if (rows.length === 0) {
    throw new AttendanceHtmlError("invalid-table", "Attendance table has no rows.");
  }

  let headerIndex = -1;
  let headers: string[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const cells = cellsInRow(rows[index]);
    const candidate = cells.map((cell) => normalizeHeader(cell.value));
    if (candidate.includes("date") && candidate.includes("status")) {
      headerIndex = index;
      headers = candidate;
      break;
    }
  }

  if (headerIndex < 0) {
    throw new AttendanceHtmlError("invalid-table", "Attendance table headers were not found.");
  }

  const required = ["date", "teacher", "subject", "subjecttype", "classtiming", "status"];
  if (required.some((header) => !headers.includes(header))) {
    throw new AttendanceHtmlError("invalid-table", "Attendance table is missing required columns.");
  }

  const indexOf = (header: string): number => headers.indexOf(header);
  const records: AttendanceRecord[] = [];

  for (const row of rows.slice(headerIndex + 1)) {
    const cells = cellsInRow(row);
    if (cells.length < headers.length) continue;

    const values = headers.map((_, index) => cells[index]?.value ?? "");
    const date = parseCollegeDate(values[indexOf("date")]);
    const timing = normalizeTimeRange(values[indexOf("classtiming")]);
    if (!date || !timing) continue;

    const rawStatus = normalizeWhitespace(values[indexOf("status")]);
    const loweredStatus = rawStatus.toLocaleLowerCase("en-US");
    const status =
      loweredStatus === "present" ? "Present" : loweredStatus === "absent" ? "Absent" : null;

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
      status,
    });
  }

  return records;
}
