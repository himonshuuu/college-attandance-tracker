import { describe, expect, it } from "vitest";
import { dueAttempt } from "../src/monitor";
import { normalizeTimeRange, parseCollegeDate } from "../src/time";

describe("college timetable time parsing", () => {
  it.each([
    ["09.15-10.15", "09:15", "10:15"],
    ["10.15-11.15", "10:15", "11:15"],
    ["11.15-12.15", "11:15", "12:15"],
    ["12.15-01.15", "12:15", "13:15"],
    ["02.15-03.15", "14:15", "15:15"],
  ])("normalizes %s", (raw, startTime, endTime) => {
    expect(normalizeTimeRange(raw)).toMatchObject({ startTime, endTime });
  });
});

describe("attendance date parsing", () => {
  it("normalizes college dates without timezone drift", () => {
    expect(parseCollegeDate("03-09-2026")).toBe("2026-09-03");
  });
});

describe("retry schedule", () => {
  const entry = { endTime: "11:15" };

  it("only returns attempts at 0, 15, and 30 minutes", () => {
    expect(dueAttempt(entry, 11 * 60 + 15)).toEqual({ attempt: 1, offset: 0 });
    expect(dueAttempt(entry, 11 * 60 + 30)).toEqual({ attempt: 2, offset: 15 });
    expect(dueAttempt(entry, 11 * 60 + 45)).toEqual({ attempt: 3, offset: 30 });
    expect(dueAttempt(entry, 11 * 60 + 20)).toBeNull();
  });
});
