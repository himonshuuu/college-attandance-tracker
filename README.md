# College Attendance Monitor

A lightweight TypeScript Cloudflare Worker that reads the My College attendance report with an authenticated PHP session, learns a recurring timetable from historical rows, and sends Discord embeds when a class is marked Present or Absent.

It uses only Cloudflare Workers, Cloudflare KV, and native Web APIs. There is no Puppeteer, browser automation, server, frontend, SQLite, or external database.

## How it works

Every scheduled invocation:

1. Computes the current year and month in `Asia/Kolkata`.
2. Sends a multipart form POST containing `year` and the full month name.
3. Parses `table#TodaysClass` by column names, not row order or Sl No.
4. Merges the returned records into a KV timetable. Timetable identity is weekday, subject, teacher, subject type, and normalized start/end time. Topic and Sl No are deliberately excluded.
5. Checks only today's learned classes at their end time, fifteen minutes later, or thirty minutes later.
6. Treats an existing `Present` or `Absent` row as final. An `Absent` row never causes a retry.
7. Sends a final missing-attendance warning only when no matching row exists at attempt 3.

The timetable is retained in KV across months, so a new month can still use classes learned previously while new records continue to update it.

## Files

- `src/index.ts` — Worker HTTP and cron handlers.
- `src/monitor.ts` — monitoring/retry/state-transition logic.
- `src/parser.ts` — lightweight HTML table parser and entity decoding.
- `src/time.ts` — India timezone, date, and college timetable parsing.
- `src/state.ts` — KV timetable, class-instance, and authentication-error state.
- `src/discord.ts` — Discord embed delivery.
- `src/college.ts` — authenticated college endpoint request.
- `wrangler.toml` — Worker, KV binding, and every-five-minute cron configuration.

## Prerequisites

- Node.js 18 or newer.
- pnpm 9 or newer. This project records `pnpm@11.5.2` in `package.json`.
- A Cloudflare account with Workers and KV enabled.
- A Discord webhook URL.
- A current `PHPSESSID` obtained after signing into the college website.

## Install and validate

```sh
pnpm install
pnpm test
pnpm run typecheck
```

## Cloudflare setup

Log in once:

```sh
pnpm exec wrangler login
```

Create a production KV namespace:

```sh
pnpm exec wrangler kv namespace create ATTENDANCE_KV
```

The command prints an object containing an `id`. Replace `REPLACE_WITH_KV_NAMESPACE_ID` in `wrangler.toml` with that value.

For local `wrangler dev` data, create a preview namespace too:

```sh
pnpm exec wrangler kv namespace create ATTENDANCE_KV --preview
```

Replace `REPLACE_WITH_KV_PREVIEW_NAMESPACE_ID` with the preview `id`. Production and preview data should remain separate.

Set the secrets. Wrangler does not put these values in the repository:

```sh
pnpm exec wrangler secret put COLLEGE_PHPSESSID
pnpm exec wrangler secret put COLLEGE_ATTENDANCE_URL
pnpm exec wrangler secret put COLLEGE_ORIGIN
pnpm exec wrangler secret put COLLEGE_REFERER
pnpm exec wrangler secret put DISCORD_WEBHOOK_URL
```

Each command prompts for the value. The college endpoint, origin, referer, session ID, and webhook are all runtime secrets and are intentionally absent from the source code and `wrangler.toml`. Do not put them in a committed file, logs, or Discord message content.

Deploy:

```sh
pnpm run deploy
```

The cron expressions are UTC because Cloudflare cron schedules are UTC. They run every 15 minutes from 09:15 through 16:45 IST Monday-Saturday, including 16:15, 16:30, and 16:45 so a class ending at 16:15 can complete its retry window. The Worker independently checks India local time and ignores Sunday and irrelevant minutes.

## Local manual test

Create `.dev.vars` locally (it is ignored by Git):

```text
COLLEGE_PHPSESSID=your-current-session-id
COLLEGE_ATTENDANCE_URL=your-private-attendance-endpoint-url
COLLEGE_ORIGIN=your-private-college-origin-url
COLLEGE_REFERER=your-private-college-referer-url
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/your-id/your-token
```

Start the Worker:

```sh
pnpm dev
```

In another terminal:

```sh
curl http://localhost:8787/
```

The response is safe JSON containing the India time, record count, learned timetable count, classes checked, and actions. It never contains the session ID or webhook URL.

After deployment, the same check is:

```sh
curl https://<your-worker-subdomain>.<your-account-subdomain>.workers.dev/
```

The GET endpoint runs one cycle immediately. It does not bypass the college/session request or the KV duplicate-prevention state.

## Replacing an expired PHP session

Sign in to the college site again, copy the new `PHPSESSID` cookie value, and run:

```sh
pnpm exec wrangler secret put COLLEGE_PHPSESSID
```

The next valid response clears the one-time authentication-error flag in KV. While the session is invalid, the Worker sends at most one authentication warning. It does not treat an expired-session login page as an empty attendance report.

## KV state and duplicate prevention

The Worker stores:

- `state:timetable` — learned recurring classes.
- `class:<encoded-key>` — attempts and final status for each date/subject/teacher/start/end class instance.
- `state:authentication-error` — a one-value latch that prevents an authentication warning every 15 minutes.

The class key is based on the date, subject, teacher, normalized start time, and normalized end time. An attempt slot is also stored before the college result is processed, so repeated executions in the same minute do not repeat that attempt. Once a Discord notification is successfully delivered, the class state is marked completed and later cron runs skip it.

As with any KV-only design, Cloudflare KV has eventual consistency across locations. The pre-attempt marker makes normal repeated cron/manual invocations idempotent within the serving location; do not run overlapping manual tests against the production endpoint at the same scheduled minute.

## Retry semantics

For a learned class ending at 11:15:

- 11:15 — attempt 1.
- 11:30 — attempt 2 if the matching row is still absent.
- 11:45 — attempt 3; if still absent, send `⚠️ Attendance Not Updated` and complete the class.

If the matching row exists at any attempt and its normalized status is `Present`, send `🟢 Attendance — Present`, complete the class, and stop. If it is `Absent`, send `🔴 Attendance — Absent`, complete the class, and stop. Status never controls retries; record existence does.

Rows discovered from previous dates are used only for timetable learning. They do not generate old attendance notifications. Only a class instance for the current India date and current due minute is eligible for monitoring.

## Troubleshooting

Useful non-secret logs are available in the Cloudflare dashboard. Errors are intentionally reduced to safe categories and never include exception text, cookie headers, or webhook URLs.

If no classes are learned yet, let the Worker receive a valid report containing historical rows. The system cannot infer a never-seen weekday/subject/time before the college website has supplied at least one record for it.

If a new Worker name or KV namespace is needed, update `name` and the namespace IDs in `wrangler.toml`, then run `pnpm run typecheck`, `pnpm test`, and `pnpm run deploy` again.
