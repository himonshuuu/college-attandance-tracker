import { createSign } from "node:crypto";
import nodemailer from "nodemailer";
import { env } from "../../config/env";
import { pool } from "../../db/pool";
import { log } from "../../observability/logger";
import { fetchStudentProfile } from "../college/college.service";
import { getCachedAttendance } from "../attendance/attendance.service";

export interface NotificationUser {
  id: number;
  email: string;
  enrollment_id: string;
  name: string;
}

interface Subscription {
  id: number;
  enrollment_id: string;
  method: "browser" | "email" | "monthly_report" | string;
  email: string | null;
  push_subscription: string | null;
}

interface AttendanceLike {
  date: string;
  subject?: string;
  teacher?: string;
  classTiming?: string;
  status?: string | null;
}

export async function getSubscriptions(enrollmentId: string): Promise<Subscription[]> {
  const result = await pool.query<Subscription>(
    `SELECT id, enrollment_id, method, email, push_subscription
       FROM subscriptions
      WHERE enrollment_id = $1
      ORDER BY id`,
    [enrollmentId],
  );
  return result.rows;
}

async function sendThroughResend(to: string, subject: string, text: string, html?: string): Promise<void> {
  if (!env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not configured");
  const payload: Record<string, unknown> = { from: env.RESEND_FROM, to: [to], subject, text };
  if (html) payload.html = html;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Resend API Error ${response.status}`);
}

const sesTransporter = env.SES_SMTP_USERNAME && env.SES_SMTP_PASSWORD
  ? nodemailer.createTransport({
      host: env.SES_SMTP_HOST,
      port: env.SES_SMTP_PORT,
      secure: env.SES_SMTP_PORT === 465,
      auth: { user: env.SES_SMTP_USERNAME, pass: env.SES_SMTP_PASSWORD },
    })
  : null;

async function sendThroughSes(to: string, subject: string, text: string, html?: string): Promise<void> {
  if (!sesTransporter) throw new Error("SES SMTP credentials are not configured");
  await sesTransporter.sendMail({ from: env.SES_FROM, to, subject, text, ...(html ? { html } : {}) });
}

export async function sendEmail(to: string, subject: string, text: string, html?: string): Promise<void> {
  let sesError: unknown;
  if (sesTransporter) {
    try {
      await sendThroughSes(to, subject, text, html);
      log("debug", "email-sent", { provider: "aws-ses" });
      return;
    } catch (error) {
      sesError = error;
      log("warn", "ses-email-failed-falling-back", { error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (env.RESEND_API_KEY) {
    try {
      await sendThroughResend(to, subject, text, html);
      log("debug", "email-sent", { provider: "resend-fallback" });
      return;
    } catch (error) {
      throw new Error(`SES and Resend email delivery failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (sesError instanceof Error) throw sesError;
  log("warn", "email-notification-skipped", { reason: "No SES or Resend credentials are configured" });
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function emailCard(options: { heading: string; introHtml: string; button?: { label: string; url: string }; bodyHtml?: string; footerHtml?: string; wide?: boolean }): string {
  const maxWidth = options.wide ? "650px" : "520px";
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:${maxWidth};margin:0 auto;padding:24px;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;">
    <h2 style="margin:0 0 8px;font-size:18px;color:#0f172a;">${options.heading}</h2>
    <p style="margin:0 0 16px;font-size:14px;color:#475569;">${options.introHtml}</p>
    ${options.button ? `<a href="${options.button.url}" style="display:inline-block;padding:12px 20px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:10px;font-size:14px;font-weight:700;">${options.button.label}</a>` : ""}
    ${options.bodyHtml ?? ""}
    <p style="margin:16px 0 0;font-size:12px;color:#94a3b8;">${options.footerHtml ?? "— Attendance Monitor"}</p>
  </div>`;
}

function detailRows(rows: Array<[string, string]>): string {
  return `<table style="width:100%;border-collapse:collapse;margin-top:4px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;font-size:13px;">${rows.map(([label, value]) => `<tr><td style="padding:8px 12px;color:#64748b;width:40%;">${label}</td><td style="padding:8px 12px;color:#0f172a;font-weight:600;">${value}</td></tr>`).join("")}</table>`;
}

async function notifyDiscord(student: NotificationUser, record: AttendanceLike): Promise<void> {
  if (!env.DISCORD_WEBHOOK_URL) return;
  const present = record.status === "Present";
  const response = await fetch(env.DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      allowed_mentions: { parse: [] },
      embeds: [{
        title: present ? "🟢 Present" : "🔴 Absent",
        color: present ? 0x2ecc71 : 0xe74c3c,
        fields: [
          { name: "Student", value: student.name || `ID ${student.id}`, inline: true },
          { name: "Subject", value: record.subject ?? "—", inline: true },
          { name: "Teacher", value: record.teacher ?? "—", inline: true },
          { name: "Date", value: record.date, inline: true },
          { name: "Time", value: record.classTiming ?? "—", inline: true },
        ],
        timestamp: new Date().toISOString(),
      }],
    }),
  });
  if (!response.ok) throw new Error(`Discord webhook returned HTTP ${response.status}`);
}

function rawFcmToken(value: string): string {
  try {
    const parsed = JSON.parse(value) as { token?: string; endpoint?: string };
    if (parsed.token) return parsed.token;
    if (parsed.endpoint) return parsed.endpoint.split("/").at(-1) ?? value;
  } catch {
    // Raw FCM token.
  }
  return value;
}

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

async function sendFcmNotification(token: string, title: string, body: string, data: Record<string, string> = {}): Promise<void> {
  const fcmToken = rawFcmToken(token);
  if (env.FIREBASE_SERVICE_ACCOUNT) {
    const account = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT) as { project_id: string; client_email: string; private_key: string };
    const now = Math.floor(Date.now() / 1000);
    const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payload = base64Url(JSON.stringify({ iss: account.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", exp: now + 3600, iat: now }));
    const signer = createSign("RSA-SHA256");
    signer.update(`${header}.${payload}`);
    const assertion = `${header}.${payload}.${signer.sign(account.private_key, "base64url")}`;
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    });
    if (!tokenResponse.ok) throw new Error(`Google OAuth token returned HTTP ${tokenResponse.status}`);
    const auth = await tokenResponse.json() as { access_token: string };
    const response = await fetch(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${auth.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message: { token: fcmToken, notification: { title, body }, data, webpush: { headers: { Urgency: "high" }, notification: { title, body, icon: "/favicon.ico", requireInteraction: true } } } }),
    });
    if (!response.ok) throw new Error(`FCM v1 returned HTTP ${response.status}`);
    return;
  }
  if (env.FIREBASE_SERVER_KEY) {
    const response = await fetch("https://fcm.googleapis.com/fcm/send", {
      method: "POST",
      headers: { Authorization: `key=${env.FIREBASE_SERVER_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ to: fcmToken, notification: { title, body }, data }),
    });
    if (!response.ok) throw new Error(`FCM legacy returned HTTP ${response.status}`);
    return;
  }
  throw new Error("Firebase credentials are not configured");
}

export async function notifyStudent(student: NotificationUser, record: AttendanceLike): Promise<void> {
  await notifyDiscord(student, record);
  const subscriptions = await getSubscriptions(student.enrollment_id);
  const present = record.status === "Present";
  const title = present ? "🟢 Present" : "🔴 Absent";
  const subject = record.subject ?? "Attendance";
  const body = `${subject} — ${record.teacher ?? ""}\n${record.date} ${record.classTiming ?? ""}`;
  for (const subscription of subscriptions) {
    try {
      if (subscription.method === "email" && subscription.email) {
        const status = (record.status ?? "Marked").toUpperCase();
        const badge = present ? "background:#dcfce7;color:#15803d;" : "background:#fee2e2;color:#b91c1c;";
        await sendEmail(subscription.email, `${title} — ${subject}`, `Hi ${student.name},\n\nYou were marked ${status} for ${subject}.\n\nDate: ${record.date}\nTime: ${record.classTiming ?? "—"}\nTeacher: ${record.teacher ?? "—"}\n\n— Attendance Monitor`, emailCard({
          heading: `${title} — ${escapeHtml(subject)}`,
          introHtml: `Hi ${escapeHtml(student.name)}, you were marked <strong>${status}</strong> for <strong>${escapeHtml(subject)}</strong>.`,
          bodyHtml: `<div style="margin-top:4px;"><span style="display:inline-block;padding:4px 12px;border-radius:12px;font-size:12px;font-weight:700;${badge}">${status}</span></div>${detailRows([["Date", escapeHtml(record.date)], ["Time", escapeHtml(record.classTiming ?? "—")], ["Teacher", escapeHtml(record.teacher ?? "—")]])}`,
        }));
      } else if (subscription.method === "browser" && subscription.push_subscription) {
        await sendFcmNotification(subscription.push_subscription, title, body, { enrollmentId: student.enrollment_id, subject, status: record.status ?? "", date: record.date });
      }
    } catch (error) {
      log("error", "notification-failed", { method: subscription.method, error: error instanceof Error ? error.message : String(error) });
    }
  }
}

export async function notifyAuthError(student: NotificationUser): Promise<void> {
  if (!env.DISCORD_WEBHOOK_URL) return;
  const response = await fetch(env.DISCORD_WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ allowed_mentions: { parse: [] }, embeds: [{ title: "⚠️ Auth Error", description: `College login failed for ${student.name}.`, color: 0xe67e22, timestamp: new Date().toISOString() }] }) });
  if (!response.ok) throw new Error(`Discord webhook returned HTTP ${response.status}`);
}

export async function notifyNotUpdated(student: NotificationUser, details: { subject: string; teacher: string; date: string }): Promise<void> {
  if (!env.DISCORD_WEBHOOK_URL) return;
  const response = await fetch(env.DISCORD_WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ allowed_mentions: { parse: [] }, embeds: [{ title: "⚠️ Attendance Not Updated", description: `Attendance not available 30min after class for ${student.name}.`, color: 0xf1c40f, fields: [{ name: "Subject", value: details.subject, inline: true }, { name: "Teacher", value: details.teacher, inline: true }, { name: "Date", value: details.date, inline: true }], timestamp: new Date().toISOString() }] }) });
  if (!response.ok) throw new Error(`Discord webhook returned HTTP ${response.status}`);
}

export async function sendWelcomeEmail(email: string, enrollmentId: string): Promise<void> {
  await sendEmail(email, "Welcome to Attendance Monitor", `Hi,\n\nWelcome to Attendance Monitor! Your account has been created.\n\nEnrollment ID: ${enrollmentId}\n\nYou will now receive notifications when your attendance is marked in class.\n\n— Attendance Monitor`, emailCard({ heading: "Welcome to Attendance Monitor", introHtml: "Your account has been created. You will now receive notifications when your attendance is marked in class.", bodyHtml: detailRows([["Email", escapeHtml(email)], ["Enrollment ID", escapeHtml(enrollmentId)]]) }));
}

export async function sendPasswordResetEmail(email: string, resetLink: string): Promise<void> {
  await sendEmail(email, "Reset your Attendance Monitor password", `Hi,\n\nWe received a request to reset the password for your Attendance Monitor account (${email}).\n\nReset your password using this link (valid for 1 hour, single use):\n${resetLink}\n\nIf you did not request this, you can safely ignore this email.\n\n— Attendance Monitor`, emailCard({ heading: "Reset your password", introHtml: `We received a request to reset the password for <strong>${escapeHtml(email)}</strong>. Click the button below (valid for 1 hour, single use):`, button: { label: "Reset password", url: resetLink }, bodyHtml: `<p style="margin:16px 0 0;font-size:12px;color:#94a3b8;word-break:break-all;">Or copy this link:<br/>${escapeHtml(resetLink)}</p>`, footerHtml: "If you did not request this, you can safely ignore this email." }));
}

export async function sendStreakEmail(email: string, name: string, kind: "broken" | "milestone", streak: number): Promise<void> {
  const firstName = escapeHtml((name || "there").split(" ")[0]);
  const broken = kind === "broken";
  await sendEmail(email, broken ? "Your attendance streak ended — start a new one 💪" : `${streak}-class attendance streak! 🔥`, broken ? `Hi ${name},\n\nYour ${streak}-class attendance streak just ended with an absent.\n\n— Attendance Monitor` : `Hi ${name},\n\nAmazing — you've attended ${streak} classes in a row! Keep it going.\n\n— Attendance Monitor`, emailCard({ heading: broken ? `Streak ended at ${streak} 🔥` : `${streak}-class streak! 🔥`, introHtml: broken ? `Hi ${firstName}, your <strong>${streak}-class streak</strong> just ended with an absent. Attend the next class to start a fresh streak!` : `Hi ${firstName}, amazing consistency — you've attended <strong>${streak} classes in a row</strong>!`, footerHtml: "Streak update • Attendance Monitor" }));
}

export async function sendMonthlyReportEmail(studentEmail: string, enrollmentId: string, monthName?: string, year?: number): Promise<void> {
  const date = new Date();
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const month = monthName ?? months[date.getMonth()];
  const reportYear = year ?? date.getFullYear();
  let profile = { name: "Student", className: "—", stream: "—" };
  let records: AttendanceLike[] = [];
  try {
    const [studentProfile, attendance] = await Promise.all([fetchStudentProfile(enrollmentId), getCachedAttendance(enrollmentId, reportYear, month)]);
    profile = studentProfile;
    records = attendance;
  } catch (error) {
    log("warn", "monthly-report-data-failed", { error: error instanceof Error ? error.message : String(error) });
  }
  const total = records.length;
  const present = records.filter((record) => record.status === "Present").length;
  const absent = records.filter((record) => record.status === "Absent").length;
  const pct = total ? Math.round((present / total) * 100) : 0;
  const subjectMap = new Map<string, { present: number; absent: number; total: number }>();
  for (const record of records) {
    const entry = subjectMap.get(record.subject ?? "Unknown") ?? { present: 0, absent: 0, total: 0 };
    entry.total++;
    if (record.status === "Present") entry.present++;
    if (record.status === "Absent") entry.absent++;
    subjectMap.set(record.subject ?? "Unknown", entry);
  }
  const subjectRows = [...subjectMap.entries()].sort(([, left], [, right]) => (left.present / Math.max(1, left.total)) - (right.present / Math.max(1, right.total))).map(([name, value]) => `<tr><td style="padding:10px;border-bottom:1px solid #e2e8f0;font-weight:600;">${escapeHtml(name)}</td><td style="padding:10px;color:#16a34a;">${value.present}</td><td style="padding:10px;color:#dc2626;">${value.absent}</td><td style="padding:10px;">${value.total}</td><td style="padding:10px;font-weight:700;">${Math.round((value.present / Math.max(1, value.total)) * 100)}%</td></tr>`).join("");
  const recordRows = records.slice(0, 30).map((record) => `<tr><td style="padding:8px 10px;">${escapeHtml(record.date)}</td><td style="padding:8px 10px;font-weight:500;">${escapeHtml(record.subject ?? "—")}</td><td style="padding:8px 10px;">${escapeHtml(record.teacher ?? "—")}</td><td style="padding:8px 10px;">${escapeHtml(record.classTiming ?? "—")}</td><td style="padding:8px 10px;">${escapeHtml(record.status ?? "—")}</td></tr>`).join("");
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:650px;margin:0 auto;padding:24px;background:#fff;border:1px solid #e2e8f0;border-radius:16px;"><h2 style="color:#0f172a;">Monthly Attendance Report</h2><p style="color:#475569;">Official attendance summary for <strong>${month} ${reportYear}</strong> — ${escapeHtml(profile.name)} (${escapeHtml(enrollmentId)}).</p>${detailRows([["Student Name", escapeHtml(profile.name)], ["Enrollment ID", escapeHtml(enrollmentId)], ["Class & Section", escapeHtml(profile.className)], ["Stream", escapeHtml(profile.stream)], ["Total", String(total)], ["Present", String(present)], ["Absent", String(absent)], ["Score", `${pct}%`]])}<h3 style="margin-top:24px;color:#1e293b;">Subject-wise Breakdown</h3><table style="width:100%;border-collapse:collapse;font-size:12px;"><tr style="background:#f1f5f9;"><th style="text-align:left;padding:8px;">Subject</th><th style="text-align:left;padding:8px;">Present</th><th style="text-align:left;padding:8px;">Absent</th><th style="text-align:left;padding:8px;">Total</th><th style="text-align:left;padding:8px;">Score</th></tr>${subjectRows || "<tr><td colspan=\"5\">No subject records found</td></tr>"}</table><h3 style="margin-top:24px;color:#1e293b;">Recent Class Records (${total} Total)</h3><table style="width:100%;border-collapse:collapse;font-size:11px;"><tr style="background:#f1f5f9;"><th style="text-align:left;padding:8px;">Date</th><th style="text-align:left;padding:8px;">Subject</th><th style="text-align:left;padding:8px;">Teacher</th><th style="text-align:left;padding:8px;">Time</th><th style="text-align:left;padding:8px;">Status</th></tr>${recordRows || "<tr><td colspan=\"5\">No records found</td></tr>"}</table><p style="color:#94a3b8;">— Attendance Monitor</p></div>`;
  await sendEmail(studentEmail, `Monthly Attendance Report - ${month} ${reportYear}`, `Monthly Attendance Report for ${profile.name} (${month} ${reportYear}): Overall Attendance: ${pct}% (${present}/${total} classes).`, html);
}

export async function sendTestNotification(enrollmentId: string): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  for (const subscription of await getSubscriptions(enrollmentId)) {
    try {
      if (subscription.method === "email" && subscription.email) {
        await sendEmail(subscription.email, "Test Notification", "Your attendance notifications are working! You will receive alerts here when your attendance is marked.\n\n— Attendance Monitor", emailCard({ heading: "Notifications are working", introHtml: "Your attendance notifications are working! You will receive alerts here when your attendance is marked.", bodyHtml: detailRows([["Enrollment ID", escapeHtml(enrollmentId)]]) }));
        result.email = true;
      } else if (subscription.method === "monthly_report" && subscription.email) {
        await sendMonthlyReportEmail(subscription.email, enrollmentId);
        result.monthly_report = true;
      } else if (subscription.method === "browser" && subscription.push_subscription) {
        await sendFcmNotification(subscription.push_subscription, "Firebase Notifications Working", "You will receive real-time attendance alerts on this device.", { test: "true" });
        result.browser = true;
      }
    } catch (error) {
      const errors = (result.errors as Array<unknown> | undefined) ?? [];
      errors.push({ method: subscription.method, message: error instanceof Error ? error.message : String(error) });
      result.errors = errors;
    }
  }
  return result;
}
