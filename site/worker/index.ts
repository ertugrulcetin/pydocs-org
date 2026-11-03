// The PyDocs Worker. It only sees /api/* and /auth/* (run_worker_first in
// wrangler.toml); every other request is a static asset served without it.
// Auth: Phase 3. Community API: Phase 4 (PLAN.md §8).
import type { AppEnv } from './env.ts';
import { callback, login, logout, SESSION_COOKIE } from './auth.ts';
import { json, parseCookies } from './http.ts';
import { verifySession } from './session.ts';

async function route(req: Request, env: AppEnv): Promise<Response> {
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

  return json({ error: 'Not found' }, 404);
}

export default {
  async fetch(req, env): Promise<Response> {
    try {
      return await route(req, env as AppEnv);
    } catch (err) {
      console.error(err);
      return json({ error: 'Something went wrong' }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
