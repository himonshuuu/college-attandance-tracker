/**
 * Polite portal access: browser-like identity, cross-invocation login
 * serialization, and retry with backoff. The goal is to never look like
 * a credential-stuffing burst to the college portal's WAF.
 */

/** Mobile Chrome — matches how most students actually use the portal. */
const BROWSER_UA =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

export function browserHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "User-Agent": BROWSER_UA,
    "Accept-Language": "en-US,en;q=0.9",
    ...extra,
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterMs(res: Response): number | null {
  const raw = res.headers.get("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  if (!isNaN(seconds) && seconds >= 0) return Math.min(seconds, 60) * 1000;
  const date = Date.parse(raw);
  if (!isNaN(date)) return Math.min(Math.max(date - Date.now(), 0), 60000);
  return null;
}

const TRANSIENT_STATUS = new Set([408, 425, 429, 502, 503, 504]);

/** Markers found on WAF / rate-limit / bot-challenge pages (not real content). */
const BLOCK_MARKERS = [
  "just a moment",
  "attention required",
  "verify you are human",
  "captcha",
  "recaptcha",
  "access denied",
  "request blocked",
  "blocked by",
  "mod_security",
  "sucuri",
  "ddos protection",
  "cloudflare ray",
  "403 forbidden",
  "too many requests",
];

/**
 * True when the HTML looks like a WAF block / challenge page rather than
 * portal content. Critical distinction: a block page must trigger backoff,
 * never session invalidation (which would cause a re-login storm).
 */
export function looksLikeBlockPage(html: string): boolean {
  if (!html) return false;
  const lower = html.toLowerCase();
  return BLOCK_MARKERS.some((m) => lower.includes(m));
}

/** Markers of this portal's login form — seen when the PHP session died. */
const LOGIN_MARKERS = ['name="phno"', "name='phno'", 'name="pass"', "name='pass'", 'type="password"'];

export function looksLikeLoginPage(html: string): boolean {
  if (!html) return false;
  const lower = html.toLowerCase();
  return LOGIN_MARKERS.some((m) => lower.includes(m));
}

/**
 * fetch with retries for transient failures (network errors, 429, 5xx).
 * Honors Retry-After, backs off exponentially with jitter. Never retries
 * 401/403 — those are session problems for the caller to handle.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxRetries = 3,
): Promise<Response> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        await sleep(600 * 2 ** attempt + Math.random() * 400);
        continue;
      }
      throw err;
    }
    if (!TRANSIENT_STATUS.has(res.status) || attempt === maxRetries) return res;
    lastError = new Error(`Portal returned HTTP ${res.status}`);
    try { await res.arrayBuffer(); } catch { /* drain */ }
    const wait = retryAfterMs(res) ?? 800 * 2 ** attempt + Math.random() * 500;
    await sleep(wait);
  }
  throw lastError instanceof Error ? lastError : new Error("Portal request failed after retries.");
}
