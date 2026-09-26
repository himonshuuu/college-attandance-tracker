import type { Env, User, AttendanceRecord } from "../types";
import { sendFcmNotification } from "./firebase";
import { fetchAttendance, fetchStudentProfile } from "../college/api";

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

export async function sendEmail(env: Env, to: string, subject: string, text: string, html?: string): Promise<void> {
  if (!env.RESEND_API_KEY) {
    console.warn("RESEND_API_KEY is not configured.");
    return;
  }
  const payload: Record<string, unknown> = {
    from: "Attendance Monitor <noreply@himon.xyz>",
    to: [to],
    subject,
    text,
  };
  if (html) {
    payload.html = html;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Resend API Error ${res.status}`);
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Shared HTML email template — every email uses this same card design
 * (white card, slate heading/body text, blue CTA button, muted footer).
 */
export function emailCard(opts: {
  heading: string;
  introHtml: string;
  button?: { label: string; url: string };
  bodyHtml?: string;
  footerHtml?: string;
  wide?: boolean;
}): string {
  const maxWidth = opts.wide ? "650px" : "520px";
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:${maxWidth};margin:0 auto;padding:24px;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;">
      <h2 style="margin:0 0 8px;font-size:18px;color:#0f172a;">${opts.heading}</h2>
      <p style="margin:0 0 16px;font-size:14px;color:#475569;">${opts.introHtml}</p>
      ${opts.button ? `<a href="${opts.button.url}" style="display:inline-block;padding:12px 20px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:10px;font-size:14px;font-weight:700;">${opts.button.label}</a>` : ""}
      ${opts.bodyHtml || ""}
      <p style="margin:16px 0 0;font-size:12px;color:#94a3b8;">${opts.footerHtml || "— Attendance Monitor"}</p>
    </div>`;
}

function detailRows(rows: Array<[string, string]>): string {
  return `<table style="width:100%;border-collapse:collapse;margin-top:4px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;font-size:13px;">` +
    rows.map(([label, value]) =>
      `<tr><td style="padding:8px 12px;color:#64748b;width:40%;">${label}</td><td style="padding:8px 12px;color:#0f172a;font-weight:600;">${value}</td></tr>`
    ).join("") +
    `</table>`;
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
        const statusUpper = (record.status || "Marked").toUpperCase();
        const badgeStyle = present
          ? "background:#dcfce7;color:#15803d;"
          : "background:#fee2e2;color:#b91c1c;";
        await sendEmail(
          env,
          sub.email,
          `${title} — ${record.subject}`,
          `Hi ${student.name},\n\nYou were marked ${statusUpper} for ${record.subject}.\n\nDate: ${record.date}\nTime: ${record.classTiming}\nTeacher: ${record.teacher}\n\n— Attendance Monitor`,
          emailCard({
            heading: `${title} — ${escapeHtml(record.subject)}`,
            introHtml: `Hi ${escapeHtml(student.name)}, you were marked <strong>${statusUpper}</strong> for <strong>${escapeHtml(record.subject)}</strong>.`,
            bodyHtml: `<div style="margin-top:4px;"><span style="display:inline-block;padding:4px 12px;border-radius:12px;font-size:12px;font-weight:700;${badgeStyle}">${statusUpper}</span></div>` +
              detailRows([
                ["Date", escapeHtml(record.date)],
                ["Time", escapeHtml(record.classTiming || "—")],
                ["Teacher", escapeHtml(record.teacher || "—")],
              ]),
          })
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
    `Hi,\n\nWelcome to Attendance Monitor! Your account has been created.\n\nEnrollment ID: ${enrollmentId}\n\nYou will now receive notifications when your attendance is marked in class.\n\n— Attendance Monitor`,
    emailCard({
      heading: "Welcome to Attendance Monitor",
      introHtml: "Your account has been created. You will now receive notifications when your attendance is marked in class.",
      bodyHtml: detailRows([["Email", escapeHtml(email)], ["Enrollment ID", escapeHtml(enrollmentId)]]),
    })
  );
}

export async function sendStreakEmail(
  env: Env,
  email: string,
  name: string,
  kind: "broken" | "milestone",
  streak: number,
): Promise<void> {
  const safeName = escapeHtml((name || "there").split(" ")[0]);
  if (kind === "broken") {
    await sendEmail(
      env,
      email,
      "Your attendance streak ended — start a new one 💪",
      `Hi ${name},\n\nYour ${streak}-class attendance streak just ended with an absent. Don't let one miss stop you — attend the next class to start a fresh streak!\n\n— Attendance Monitor`,
      emailCard({
        heading: `Streak ended at ${streak} 🔥`,
        introHtml: `Hi ${safeName}, your <strong>${streak}-class streak</strong> just ended with an absent. One miss doesn't erase your progress — attend the next class to start a fresh streak!`,
        footerHtml: "Streak update • Attendance Monitor",
      }),
    );
  } else {
    await sendEmail(
      env,
      email,
      `${streak}-class attendance streak! 🔥`,
      `Hi ${name},\n\nAmazing — you've attended ${streak} classes in a row! Keep it going.\n\n— Attendance Monitor`,
      emailCard({
        heading: `${streak}-class streak! 🔥`,
        introHtml: `Hi ${safeName}, amazing consistency — you've attended <strong>${streak} classes in a row</strong>! Keep it going and watch your rank climb.`,
        footerHtml: "Streak milestone • Attendance Monitor",
      }),
    );
  }
}

export async function sendPasswordResetEmail(env: Env, email: string, resetLink: string): Promise<void> {
  await sendEmail(
    env,
    email,
    "Reset your Attendance Monitor password",
    `Hi,\n\nWe received a request to reset the password for your Attendance Monitor account (${email}).\n\nReset your password using this link (valid for 1 hour, single use):\n${resetLink}\n\nIf you did not request this, you can safely ignore this email — your password will not change.\n\n— Attendance Monitor`,
    emailCard({
      heading: "Reset your password",
      introHtml: `We received a request to reset the password for <strong>${escapeHtml(email)}</strong>. Click the button below (valid for 1 hour, single use):`,
      button: { label: "Reset password", url: resetLink },
      bodyHtml: `<p style="margin:16px 0 0;font-size:12px;color:#94a3b8;word-break:break-all;">Or copy this link:<br/>${escapeHtml(resetLink)}</p>`,
      footerHtml: "If you did not request this, you can safely ignore this email.",
    })
  );
}

export async function sendMonthlyReportEmail(
  env: Env,
  studentEmail: string,
  enrollmentId: string,
  monthName?: string,
  year?: number
): Promise<void> {
  const now = new Date();
  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const mName = monthName || MONTHS[now.getMonth()];
  const yVal = year || now.getFullYear();

  let profile = { name: "Student", className: "—", stream: "—" };
  let records: AttendanceRecord[] = [];

  try {
    const [p, r] = await Promise.all([
      fetchStudentProfile(env, enrollmentId),
      fetchAttendance(env, enrollmentId, yVal, mName),
    ]);
    profile = p;
    records = r;
  } catch (err) {
    console.warn("Failed to fetch profile/attendance for monthly report:", err);
  }

  const total = records.length;
  const present = records.filter((r) => r.status === "Present").length;
  const absent = records.filter((r) => r.status === "Absent").length;
  const pct = total > 0 ? Math.round((present / total) * 100) : 0;
  const pctColor = pct >= 75 ? "#16a34a" : pct >= 60 ? "#d97706" : "#dc2626";

  const subjectMap: Record<string, { p: number; a: number; t: number }> = {};
  for (const r of records) {
    const k = r.subject || "Unknown";
    if (!subjectMap[k]) subjectMap[k] = { p: 0, a: 0, t: 0 };
    subjectMap[k].t++;
    if (r.status === "Present") subjectMap[k].p++;
    else if (r.status === "Absent") subjectMap[k].a++;
  }
  const subjects = Object.entries(subjectMap)
    .map(([name, d]) => ({
      name,
      present: d.p,
      absent: d.a,
      total: d.t,
      pct: d.t > 0 ? Math.round((d.p / d.t) * 100) : 0,
    }))
    .sort((a, b) => a.pct - b.pct);

  const subjectsHtml = subjects
    .map(
      (s) => `
      <tr>
        <td style="padding:10px;border-bottom:1px solid #e2e8f0;font-weight:600;color:#1e293b;">${escapeHtml(s.name)}</td>
        <td style="padding:10px;border-bottom:1px solid #e2e8f0;color:#16a34a;font-weight:600;">${s.present}</td>
        <td style="padding:10px;border-bottom:1px solid #e2e8f0;color:#dc2626;font-weight:600;">${s.absent}</td>
        <td style="padding:10px;border-bottom:1px solid #e2e8f0;font-weight:600;color:#475569;">${s.total}</td>
        <td style="padding:10px;border-bottom:1px solid #e2e8f0;font-weight:700;color:${s.pct >= 75 ? "#16a34a" : s.pct >= 60 ? "#d97706" : "#dc2626"};">${s.pct}%</td>
      </tr>`
    )
    .join("");

  const rowsHtml = records
    .slice(0, 30)
    .map(
      (r) => `
      <tr>
        <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;white-space:nowrap;font-weight:600;color:#334155;">${escapeHtml(r.date)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;font-weight:500;color:#0f172a;">${escapeHtml(r.subject)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;color:#64748b;">${escapeHtml(r.teacher || "—")}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;color:#64748b;">${escapeHtml(r.classTiming || "—")}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #f1f5f9;">
          <span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:10px;font-weight:700;${
            r.status === "Present"
              ? "background:#dcfce7;color:#15803d;"
              : r.status === "Absent"
              ? "background:#fee2e2;color:#b91c1c;"
              : "background:#f1f5f9;color:#64748b;"
          }">${r.status}</span>
        </td>
      </tr>`
    )
    .join("");

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Monthly Attendance Report - ${mName} ${yVal}</title>
      </head>
      <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;margin:0;padding:20px;background:#f8fafc;line-height:1.5;">
        <div style="max-width:650px;margin:0 auto;background:#ffffff;border-radius:16px;border:1px solid #e2e8f0;padding:24px;">
          <h2 style="margin:0 0 8px;font-size:18px;color:#0f172a;">Monthly Attendance Report</h2>
          <p style="margin:0 0 16px;font-size:14px;color:#475569;">Official attendance summary for <strong>${mName} ${yVal}</strong> — ${escapeHtml(profile.name)} (${escapeHtml(enrollmentId)}).</p>

          <!-- Student Meta Grid -->
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:14px;margin-bottom:20px;font-size:12px;">
            <div style="margin-bottom:4px;"><span style="color:#64748b;">Student Name:</span> <strong style="color:#0f172a;">${escapeHtml(profile.name)}</strong></div>
            <div style="margin-bottom:4px;"><span style="color:#64748b;">Enrollment ID:</span> <strong style="color:#0f172a;">${escapeHtml(enrollmentId)}</strong></div>
            <div style="margin-bottom:4px;"><span style="color:#64748b;">Class & Section:</span> <strong style="color:#0f172a;">${escapeHtml(profile.className)}</strong></div>
            <div><span style="color:#64748b;">Stream:</span> <strong style="color:#0f172a;">${escapeHtml(profile.stream)}</strong></div>
          </div>

          <!-- Stats Grid -->
          <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
            <tr>
              <td style="width:25%;padding:4px;">
                <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:10px;text-align:center;">
                  <div style="font-size:18px;font-weight:800;color:#2563eb;">${total}</div>
                  <div style="font-size:9px;color:#64748b;font-weight:700;text-transform:uppercase;margin-top:4px;">Total</div>
                </div>
              </td>
              <td style="width:25%;padding:4px;">
                <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:10px;text-align:center;">
                  <div style="font-size:18px;font-weight:800;color:#16a34a;">${present}</div>
                  <div style="font-size:9px;color:#64748b;font-weight:700;text-transform:uppercase;margin-top:4px;">Present</div>
                </div>
              </td>
              <td style="width:25%;padding:4px;">
                <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:10px;text-align:center;">
                  <div style="font-size:18px;font-weight:800;color:#dc2626;">${absent}</div>
                  <div style="font-size:9px;color:#64748b;font-weight:700;text-transform:uppercase;margin-top:4px;">Absent</div>
                </div>
              </td>
              <td style="width:25%;padding:4px;">
                <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:10px;text-align:center;">
                  <div style="font-size:18px;font-weight:800;color:${pctColor};">${pct}%</div>
                  <div style="font-size:9px;color:#64748b;font-weight:700;text-transform:uppercase;margin-top:4px;">Score</div>
                </div>
              </td>
            </tr>
          </table>

          <!-- Subject Summary Header -->
          <div style="font-size:14px;font-weight:700;color:#1e293b;margin-bottom:10px;padding-bottom:4px;border-bottom:1px solid #e2e8f0;">Subject-wise Breakdown</div>
          <table style="width:100%;border-collapse:collapse;margin-bottom:24px;font-size:12px;">
            <thead>
              <tr style="background:#f1f5f9;">
                <th style="text-align:left;padding:8px 10px;color:#475569;font-size:11px;text-transform:uppercase;">Subject</th>
                <th style="text-align:left;padding:8px 10px;color:#475569;font-size:11px;text-transform:uppercase;">Present</th>
                <th style="text-align:left;padding:8px 10px;color:#475569;font-size:11px;text-transform:uppercase;">Absent</th>
                <th style="text-align:left;padding:8px 10px;color:#475569;font-size:11px;text-transform:uppercase;">Total</th>
                <th style="text-align:left;padding:8px 10px;color:#475569;font-size:11px;text-transform:uppercase;">Score</th>
              </tr>
            </thead>
            <tbody>
              ${subjectsHtml || '<tr><td colSpan="5" style="padding:10px;text-align:center;color:#94a3b8;">No subject records found</td></tr>'}
            </tbody>
          </table>

          <!-- Class Logs Header -->
          <div style="font-size:14px;font-weight:700;color:#1e293b;margin-bottom:10px;padding-bottom:4px;border-bottom:1px solid #e2e8f0;">Recent Class Records (${records.length} Total)</div>
          <table style="width:100%;border-collapse:collapse;margin-bottom:24px;font-size:11px;">
            <thead>
              <tr style="background:#f1f5f9;">
                <th style="text-align:left;padding:8px 10px;color:#475569;font-size:10px;text-transform:uppercase;">Date</th>
                <th style="text-align:left;padding:8px 10px;color:#475569;font-size:10px;text-transform:uppercase;">Subject</th>
                <th style="text-align:left;padding:8px 10px;color:#475569;font-size:10px;text-transform:uppercase;">Teacher</th>
                <th style="text-align:left;padding:8px 10px;color:#475569;font-size:10px;text-transform:uppercase;">Time</th>
                <th style="text-align:left;padding:8px 10px;color:#475569;font-size:10px;text-transform:uppercase;">Status</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml || '<tr><td colSpan="5" style="padding:10px;text-align:center;color:#94a3b8;">No records found</td></tr>'}
            </tbody>
          </table>

          <p style="margin:16px 0 0;font-size:12px;color:#94a3b8;">— Attendance Monitor</p>
        </div>
      </body>
    </html>
  `;

  await sendEmail(
    env,
    studentEmail,
    `Monthly Attendance Report - ${mName} ${yVal}`,
    `Monthly Attendance Report for ${profile.name} (${mName} ${yVal}): Overall Attendance: ${pct}% (${present}/${total} classes).`,
    html
  );
}

export async function sendTestNotification(
  env: Env,
  enrollmentId: string
): Promise<{
  email?: boolean;
  browser?: boolean;
  firebase?: boolean;
  monthly_report?: boolean;
  errors?: Array<{ method: string; message: string }>;
}> {
  const result: {
    email?: boolean;
    browser?: boolean;
    firebase?: boolean;
    monthly_report?: boolean;
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
          "Your attendance notifications are working! You will receive alerts here when your attendance is marked.\n\n— Attendance Monitor",
          emailCard({
            heading: "Notifications are working",
            introHtml: "Your attendance notifications are working! You will receive alerts here when your attendance is marked.",
            bodyHtml: detailRows([["Enrollment ID", escapeHtml(enrollmentId)]]),
          })
        );
        result.email = true;
      } else if (sub.method === "monthly_report" && sub.email) {
        await sendMonthlyReportEmail(env, sub.email, enrollmentId);
        result.monthly_report = true;
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
