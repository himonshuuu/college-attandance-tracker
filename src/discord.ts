import { AttendanceRecord, Env } from "./types";

const COLORS = {
  present: 0x2ecc71,
  absent: 0xe74c3c,
  warning: 0xf1c40f,
  error: 0xe67e22,
};

function truncate(value: string, length = 1024): string {
  return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
}

function field(name: string, value: string): { name: string; value: string; inline: boolean } {
  return { name, value: truncate(value || "—"), inline: true };
}

async function postEmbed(
  env: Env,
  title: string,
  description: string,
  color: number,
  fields: { name: string; value: string; inline: boolean }[],
): Promise<void> {
  if (!env.DISCORD_WEBHOOK_URL) throw new Error("DISCORD_WEBHOOK_URL is not configured.");

  let response: Response;
  try {
    response = await fetch(env.DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        allowed_mentions: { parse: [] },
        embeds: [
          {
            title,
            description,
            color,
            fields,
            timestamp: new Date().toISOString(),
          },
        ],
      }),
    });
  } catch {
    throw new Error("Discord webhook request failed.");
  }

  if (!response.ok) throw new Error(`Discord webhook returned HTTP ${response.status}.`);
}

export async function notifyAttendance(env: Env, record: AttendanceRecord): Promise<void> {
  const present = record.status === "Present";
  await postEmbed(
    env,
    present ? "🟢 Attendance — Present" : "🔴 Attendance — Absent",
    present ? "You were marked PRESENT." : "You were marked ABSENT.",
    present ? COLORS.present : COLORS.absent,
    [
      field("Subject", record.subject),
      field("Teacher", record.teacher),
      field("Date", record.date),
      field("Time", record.classTiming),
      field("Subject Type", record.subjectType),
      field("Topic", record.topic),
      field("Class", record.className),
    ],
  );
}

export async function notifyAttendanceNotUpdated(
  env: Env,
  details: { subject: string; teacher: string; date: string; expectedTime: string },
): Promise<void> {
  await postEmbed(
    env,
    "⚠️ Attendance Not Updated",
    "Attendance was not available 30 minutes after the class ended.",
    COLORS.warning,
    [
      field("Subject", details.subject),
      field("Teacher", details.teacher),
      field("Date", details.date),
      field("Expected Time", details.expectedTime),
    ],
  );
}

export async function notifyAuthenticationError(env: Env): Promise<void> {
  await postEmbed(
    env,
    "⚠️ Attendance Monitor Authentication Error",
    "College session appears to have expired. Update COLLEGE_PHPSESSID.",
    COLORS.error,
    [],
  );
}

export async function notifyUnexpectedStatus(env: Env, record: AttendanceRecord): Promise<void> {
  await postEmbed(
    env,
    "⚠️ Attendance Status Unrecognized",
    "An attendance record exists, but its status is neither Present nor Absent. It will not be retried as missing.",
    COLORS.warning,
    [
      field("Subject", record.subject),
      field("Teacher", record.teacher),
      field("Date", record.date),
      field("Time", record.classTiming),
      field("Status", record.rawStatus),
    ],
  );
}
