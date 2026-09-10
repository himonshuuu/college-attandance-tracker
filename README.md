# College Attendance Monitor

Cloudflare Worker that wraps a college's PHP portal to fetch attendance and student profiles, with a web frontend and Discord notifications.

## Project structure

```
src/
  index.ts              Worker entry — API router + cron handler
  types.ts              TypeScript interfaces
  time.ts               IST timezone utilities
  parser.ts             Attendance HTML table parser
  monitor.ts            Cron-driven attendance monitoring loop
  students.ts           D1 student registration & queries
  discord.ts            Discord webhook embeds
  college/
    auth.ts             PHP portal login + KV session cache
    api.ts              Profile & attendance fetchers
  api/
    router.ts           URL pattern matching & dispatch
    middleware.ts        JSON responses, CORS, error handling
    attendance.ts       GET /api/attendance/:id, /summary
    students.ts         GET /api/students/:id, POST /api/students
    health.ts           GET /api/health

public/
  index.html            Frontend — student lookup, profile, attendance
  css/style.css         Styles
  js/app.js             API calls & DOM rendering

migrations/             D1 schema migrations
wrangler.toml           Worker, KV, D1, assets, cron config
```

## Setup

```sh
pnpm install
pnpm run typecheck
```

### D1 database

```sh
pnpm exec wrangler d1 create college-attendance-students
```

Copy the `database_id` into `wrangler.toml`, then apply migrations:

```sh
pnpm exec wrangler d1 migrations apply college-attendance-students --local
pnpm exec wrangler d1 migrations apply college-attendance-students --remote
```

### Secrets

```sh
pnpm exec wrangler secret put COLLEGE_LOGIN_URL
pnpm exec wrangler secret put COLLEGE_LOGIN_REFERER
pnpm exec wrangler secret put COLLEGE_PROFILE_URL
pnpm exec wrangler secret put COLLEGE_ATTENDANCE_URL
pnpm exec wrangler secret put COLLEGE_ORIGIN
pnpm exec wrangler secret put COLLEGE_REFERER
pnpm exec wrangler secret put DISCORD_WEBHOOK_URL
```

For local dev, create `.dev.vars` from `.env.example`.

### Run

```sh
pnpm dev
```

## REST API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/students/:enrollmentId` | Fetch student profile from college portal |
| `POST` | `/api/students` | Register student (`{ "enrollmentId": "..." }`) |
| `GET` | `/api/attendance/:enrollmentId?month=September&year=2026` | Attendance records |
| `GET` | `/api/attendance/:enrollmentId/summary` | Attendance summary with percentage |

All responses follow `{ success: boolean, data?: T, error?: string }`.

## Auth flow

`college/auth.ts` handles PHP session management:

1. `getSession(env, enrollmentId)` — checks KV cache (30 min TTL)
2. On cache miss, POSTs to `student_login.php` with `phno=enrollmentId&pass=enrollmentId`
3. Extracts `PHPSESSID` from `Set-Cookie`, caches in KV
4. On 401/403, caller invalidates via `invalidateSession(env, enrollmentId)`

## Monitoring

Cron triggers run every 15 min during IST work hours (Mon-Sat). The worker fetches the current month's attendance, learns the timetable, and checks each class at end time + 15 min + 30 min retries. Notifications go to Discord.

## Deploy

```sh
pnpm run deploy
```
