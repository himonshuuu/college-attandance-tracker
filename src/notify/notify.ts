import type { Env, User, AttendanceRecord } from "../types";
import { sendFcmNotification } from "./firebase";

interface Subscription {
  id: number;
  enrollment_id: string;
  method: string;
  email: string | null;
  push_subscription: string | null; // Stores FCM registration token or push details
}

export async function getSubscriptions(env: Env, enrollmentId: string): Promise<Subscription[]> {
  const result = await env.DB.prepare(
    `SELECT id, enrollment_id, method, email, push_subscription
     FROM subscriptions WHERE enrollment_id = ?`
  ).bind(enrollmentId).all<Subscription>();
  return result.results;
}

async function sendEmail(env: Env, to: string, subject: string, text: string): Promise<void> {
  if (!env.RESEND_API_KEY) {
    console.warn("RESEND_API_KEY is not configured.");
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Attendance Monitor <noreply@himon.xyz>",
      to: [to],
      subject,
      text,
    }),
  });
  if (!res.ok) throw new Error(`Resend API Error ${res.status}`);
}

async function notifyDiscord(env: Env, student: User, record: AttendanceRecord): Promise<void> {
  if (!env.DISCORD_WEBHOOK_URL) return;
  const present = record.status === "Present";
  await fetch(env.DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      allowed_mentions: { parse: [] },
      embeds: [{
        title: present ? "🟢 Present" : "🔴 Absent",
        color: present ? 0x2ecc71 : 0xe74c3c,
        fields: [
          { name: "Student", value: student.name || `ID ${student.id}`, inline: true },
          { name: "Subject", value: record.subject, inline: true },
          { name: "Teacher", value: record.teacher, inline: true },
          { name: "Date", value: record.date, inline: true },
          { name: "Time", value: record.classTiming, inline: true },
        ],
        timestamp: new Date().toISOString(),
      }],
    }),
  });
}

export async function notifyStudent(
  env: Env,
  student: User,
  record: AttendanceRecord,
): Promise<void> {
  await notifyDiscord(env, student, record);

  const subs = await getSubscriptions(env, student.enrollment_id);
  if (subs.length === 0) return;

  const present = record.status === "Present";
  const title = present ? "🟢 Present" : "🔴 Absent";
  const body = `${record.subject} — ${record.teacher}\n${record.date} ${record.classTiming}`;

  for (const sub of subs) {
    try {
      if (sub.method === "email" && sub.email) {
        await sendEmail(
          env,
          sub.email,
          `${title} — ${record.subject}`,
          `Hi ${student.name},\n\nYou were marked ${record.status?.toUpperCase()} for ${record.subject}.\n\nDate: ${record.date}\nTime: ${record.classTiming}\nTeacher: ${record.teacher}\n\n— Attendance Monitor`
        );
      } else if ((sub.method === "firebase" || sub.method === "browser") && sub.push_subscription) {
        // push_subscription contains the FCM token (or JSON with token property)
        let token = sub.push_subscription;
        try {
          const parsed = JSON.parse(sub.push_subscription);
          if (parsed.token) token = parsed.token;
        } catch {
          // Token is a raw FCM token string
        }

        await sendFcmNotification(env, {
          token,
          title,
          body,
          data: {
            enrollmentId: student.enrollment_id,
            subject: record.subject,
            status: record.status || "",
            date: record.date,
          },
        });
      }
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "notification-failed",
          method: sub.method,
          enrollmentId: student.enrollment_id,
          error: error instanceof Error ? error.message : String(error),
        })
      );
    }
  }
}

export async function notifyAuthError(env: Env, student: User): Promise<void> {
  if (!env.DISCORD_WEBHOOK_URL) return;
  await fetch(env.DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      allowed_mentions: { parse: [] },
      embeds: [
        {
          title: "⚠️ Auth Error",
          description: `College login failed for ${student.name}.`,
          color: 0xe67e22,
          timestamp: new Date().toISOString(),
        },
      ],
    }),
  });
}

export async function notifyNotUpdated(
  env: Env,
  student: User,
  details: { subject: string; teacher: string; date: string }
): Promise<void> {
  if (!env.DISCORD_WEBHOOK_URL) return;
  await fetch(env.DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      allowed_mentions: { parse: [] },
      embeds: [
        {
          title: "⚠️ Attendance Not Updated",
          description: `Attendance not available 30min after class for ${student.name}.`,
          color: 0xf1c40f,
          fields: [
            { name: "Subject", value: details.subject, inline: true },
            { name: "Teacher", value: details.teacher, inline: true },
            { name: "Date", value: details.date, inline: true },
          ],
          timestamp: new Date().toISOString(),
        },
      ],
    }),
  });
}

export async function sendWelcomeEmail(env: Env, email: string, enrollmentId: string): Promise<void> {
  await sendEmail(
    env,
    email,
    "Welcome to Attendance Monitor",
    `Hi,\n\nWelcome to Attendance Monitor! Your account has been created.\n\nEnrollment ID: ${enrollmentId}\n\nYou will now receive notifications when your attendance is marked in class.\n\n— Attendance Monitor`
  );
}

export async function sendTestNotification(
  env: Env,
  enrollmentId: string
): Promise<{
  email?: boolean;
  browser?: boolean;
  firebase?: boolean;
  errors?: Array<{ method: string; message: string }>;
}> {
  const result: {
    email?: boolean;
    browser?: boolean;
    firebase?: boolean;
    errors?: Array<{ method: string; message: string }>;
  } = {};
  const subs = await getSubscriptions(env, enrollmentId);

  for (const sub of subs) {
    try {
      if (sub.method === "email" && sub.email) {
        await sendEmail(
          env,
          sub.email,
          "Test Notification",
          "Your attendance notifications are working! You will receive alerts here when your attendance is marked.\n\n— Attendance Monitor"
        );
        result.email = true;
      } else if ((sub.method === "firebase" || sub.method === "browser") && sub.push_subscription) {
        let token = sub.push_subscription;
        try {
          const parsed = JSON.parse(sub.push_subscription);
          if (parsed.token) token = parsed.token;
        } catch {
          // Token is a raw FCM token string
        }

        await sendFcmNotification(env, {
          token,
          title: "Firebase Notifications Working",
          body: "You will receive real-time attendance alerts on this device.",
          data: { test: "true" },
        });
        result.firebase = true;
        result.browser = true;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.errors ??= [];
      result.errors.push({ method: sub.method, message });
    }
  }

  return result;
}
