// Checks every write goes through (PLAN.md §7.4 step 1–3, §8 limits, §11):
// session, same-origin, JSON content type, ban list, account age, rate limit.
import type { AppEnv } from './env.ts';
import { json, parseCookies } from './http.ts';
import { getJson, updateJson } from './r2json.ts';
import { verifySession } from './session.ts';
import type { Session } from './session.ts';
import { SESSION_COOKIE } from './auth.ts';

export const LIMITS = {
  exampleChars: 10_000,
  noteChars: 5_000,
  // Per symbol: bounds a symbol doc at ~500 KB, so a write stays far below the
  // 10 ms CPU limit (tests/cpu.test.ts). ClojureDocs' busiest pages have ~25.
  examplesPerSymbol: 50,
  seeAlsosPerSymbol: 100,
  notesPerSymbol: 50,
  writesPerHour: 20,
  writesPerDay: 100,
  minAccountAgeMs: 7 * 24 * 60 * 60 * 1000,
};

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
  response(): Response {
    return json({ message: this.message }, this.status);
  }
}

export const isAdmin = (env: AppEnv, uid: number): boolean =>
  (env.ADMIN_GITHUB_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .includes(String(uid));

/** Session for a write request, or throws 401/403. */
export async function requireWriter(req: Request, env: AppEnv, now: number): Promise<Session> {
  const origin = req.headers.get('Origin');
  if (!origin || origin !== new URL(req.url).origin) throw new HttpError(403, 'Bad origin.');
  if (req.method !== 'DELETE' && !(req.headers.get('Content-Type') ?? '').startsWith('application/json')) {
    throw new HttpError(415, 'Expected application/json.');
  }
  const s = await verifySession(parseCookies(req)[SESSION_COOKIE], env.SESSION_SECRET, now);
  if (!s) throw new HttpError(401, 'You must be logged in to do that.');
  if (await env.PRIVATE.head(`bans/${s.uid}.json`)) throw new HttpError(403, "Your account can't make changes right now.");
  if (!isAdmin(env, s.uid) && now - s.ghc < LIMITS.minAccountAgeMs) {
    throw new HttpError(403, 'Your GitHub account must be at least 7 days old to contribute.');
  }
  return s;
}

const pad = (n: number) => String(n).padStart(2, '0');
const hourKey = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}-${pad(d.getUTCHours())}`;
const dayKey = (d: Date) => hourKey(d).slice(0, 10);

/** Counts one write; throws 429 over 20/hour or 100/day (admins are exempt). */
export async function takeRateLimit(env: AppEnv, uid: number, now: number): Promise<void> {
  if (isAdmin(env, uid)) return;
  const d = new Date(now);
  const hKey = `ratelimit/${uid}/h-${hourKey(d)}.json`;
  const dKey = `ratelimit/${uid}/d-${dayKey(d)}.json`;
  const [h, day] = await Promise.all([getJson<{ n: number }>(env.PRIVATE, hKey), getJson<{ n: number }>(env.PRIVATE, dKey)]);
  if ((h?.n ?? 0) >= LIMITS.writesPerHour || (day?.n ?? 0) >= LIMITS.writesPerDay) {
    throw new HttpError(429, 'You have made a lot of changes recently. Please try again later.');
  }
  const inc = (c: { n: number } | null) => ({ n: (c?.n ?? 0) + 1 });
  await Promise.all([
    updateJson(env.PRIVATE, hKey, inc, { cacheControl: 'no-store' }),
    updateJson(env.PRIVATE, dKey, inc, { cacheControl: 'no-store' }),
  ]);
}

/** Parses a JSON body, or throws 400. */
export async function readBody<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, 'Invalid JSON body.');
  }
}
