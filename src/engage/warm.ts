import { sleep } from "../college/net";
import type { Env } from "../types";
import { getCachedAttendance } from "./cache";
import { currentMonth } from "./ranks";

/**
 * Nightly cache warm (runs ~2:30 AM IST when the portal is idle):
 * sequentially refreshes every active student's current-month attendance
 * into the shared cache, so daytime traffic almost never hits the portal.
 * Sequential + small pacing = the politest possible bulk pattern.
 */
export async function runCacheWarm(env: Env): Promise<{ warmed: number; failed: number }> {
  const { year, monthName } = currentMonth();
  const users = await env.DB.prepare(`SELECT enrollment_id FROM users WHERE active = 1 ORDER BY id`)
    .all<{ enrollment_id: string }>()
    .catch(() => ({ results: [] as { enrollment_id: string }[] }));

  let warmed = 0;
  let failed = 0;
  for (const u of users.results) {
    try {
      // ttl 0 forces a genuine refresh; stale cache is returned (not thrown)
      // when the portal is unreachable for a student.
      await getCachedAttendance(env, u.enrollment_id, year, monthName, 0);
      warmed++;
    } catch {
      failed++;
    }
    await sleep(250);
  }

  console.log(JSON.stringify({ event: "cache-warm-done", warmed, failed }));
  return { warmed, failed };
}
