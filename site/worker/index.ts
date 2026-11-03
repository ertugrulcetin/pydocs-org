// The PyDocs Worker. It only sees /api/* and /auth/* (run_worker_first in
// wrangler.toml); every other request is a static asset served without it.
// Auth: Phase 3. Community API: Phase 4 (PLAN.md §8).
import type { AppEnv } from './env.ts';
import { callback, login, logout, SESSION_COOKIE } from './auth.ts';
import { handleSymbolApi } from './community.ts';
import type { WaitUntil } from './community.ts';
import { HttpError } from './guards.ts';
import { json, parseCookies } from './http.ts';
import { ConflictError } from './r2json.ts';
import { verifySession } from './session.ts';

/** Public keys in pydocs-content (PLAN.md §7.1). */
const PUBLIC_KEY =
  /^(?:symbols\/[A-Za-z_][A-Za-z0-9_.]*\/[A-Za-z_][A-Za-z0-9_.]*|history\/ex_[0-9A-HJKMNP-TV-Z]{26}|users\/\d{1,12}|logins\/[a-z0-9-]{1,39}|activity\/recent)\.json$/;

async function route(req: Request, env: AppEnv, ctx: WaitUntil): Promise<Response> {
  const { pathname } = new URL(req.url);
  const get = req.method === 'GET' || req.method === 'HEAD';

  if (get && pathname === '/auth/login') return login(req, env);
  if (get && pathname === '/auth/callback') return callback(req, env);
  if (get && pathname === '/auth/logout') return logout();

  if (get && pathname === '/api/health') return json({ ok: true });
  if (get && pathname === '/api/me') {
    const s = await verifySession(parseCookies(req)[SESSION_COOKIE], env.SESSION_SECRET);
    return s ? json({ id: s.uid, login: s.login }) : json({ error: 'Not logged in' }, 401);
  }

  // Read path [B] for public content (local dev, previews): same keys as data.pydocs.org.
  if (get && pathname.startsWith('/api/r/')) {
    const key = pathname.slice('/api/r/'.length);
    if (!PUBLIC_KEY.test(key) || key.includes('..')) throw new HttpError(404, 'Not found.');
    const obj = await env.CONTENT.get(key);
    if (!obj) return json({ message: 'Not found.' }, 404);
    return new Response(obj.body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  }

  // /api/s/{module}/{qualname}[/{examples|see-alsos|notes}[/{id}]]
  if (pathname.startsWith('/api/s/')) {
    let segments: string[];
    try {
      segments = pathname.slice('/api/s/'.length).split('/').map(decodeURIComponent);
    } catch {
      throw new HttpError(404, 'Not found.');
    }
    if (segments.length < 2 || segments.some((s) => s === '')) throw new HttpError(404, 'Not found.');
    return handleSymbolApi(req, env, ctx, segments);
  }

  return json({ error: 'Not found' }, 404);
}

export default {
  async fetch(req, env, ctx): Promise<Response> {
    try {
      return await route(req, env as unknown as AppEnv, ctx);
    } catch (err) {
      if (err instanceof HttpError) return err.response();
      if (err instanceof ConflictError) return json({ message: 'Someone else changed this at the same time. Please try again.' }, 409);
      console.error(err);
      return json({ error: 'Something went wrong' }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
