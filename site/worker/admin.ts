// Admin API (PLAN.md §8, Phase 6). Admins are ADMIN_GITHUB_IDS.
//   GET  /api/admin/me                -> {admin: true} or 403
//   GET  /api/admin/bans              -> [{id, login, by, at, reason}]
//   POST /api/admin/ban   {login, reason?}
//   POST /api/admin/unban {login}
//   GET  /api/admin/audit?day=YYYY-MM-DD[&cursor=...] -> {records, cursor}
// Deleting content uses the normal DELETE endpoints, which already allow admins.
import type { AppEnv } from './env.ts';
import { HttpError, isAdmin, readBody, requireWriter } from './guards.ts';
import { json, parseCookies } from './http.ts';
import { getJson, putJson } from './r2json.ts';
import { verifySession } from './session.ts';
import { SESSION_COOKIE } from './auth.ts';
import { loginKey } from './users.ts';
import { ulid } from './ulid.ts';

export interface Ban {
  id: number;
  login: string;
  reason: string;
  by: { id: number; login: string };
  at: number;
}

const AUDIT_PAGE = 40; // stays well under the free plan's per-request subrequest limit

async function requireAdminRead(req: Request, env: AppEnv) {
  const s = await verifySession(parseCookies(req)[SESSION_COOKIE], env.SESSION_SECRET);
  if (!s) throw new HttpError(401, 'You must be logged in to do that.');
  if (!isAdmin(env, s.uid)) throw new HttpError(403, 'Admins only.');
  return s;
}

async function resolveLogin(env: AppEnv, login: unknown): Promise<{ id: number; login: string }> {
  const name = typeof login === 'string' ? login.trim().replace(/^@/, '') : '';
  if (!/^[A-Za-z0-9-]{1,39}$/.test(name)) throw new HttpError(422, 'Enter a GitHub login.');
  const ref = await getJson<{ id: number }>(env.CONTENT, loginKey(name));
  if (!ref) throw new HttpError(404, `No PyDocs user called ${name}.`);
  return { id: ref.id, login: name };
}

export async function handleAdmin(req: Request, env: AppEnv, path: string, now = Date.now()): Promise<Response> {
  const method = req.method;

  if (method === 'GET') {
    await requireAdminRead(req, env);
    if (path === 'me') return json({ admin: true });
    if (path === 'bans') {
      const listed = await env.PRIVATE.list({ prefix: 'bans/' });
      const bans = await Promise.all(listed.objects.slice(0, AUDIT_PAGE).map((o: { key: string }) => getJson<Ban>(env.PRIVATE, o.key)));
      return json(bans.filter(Boolean).sort((a, b) => b!.at - a!.at));
    }
    if (path === 'audit') {
      const url = new URL(req.url);
      const day = url.searchParams.get('day') ?? new Date(now).toISOString().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new HttpError(422, 'Bad day.');
      const listed = await env.PRIVATE.list({ prefix: `audit/${day}/`, limit: AUDIT_PAGE, cursor: url.searchParams.get('cursor') ?? undefined });
      const records = await Promise.all(listed.objects.map((o: { key: string }) => getJson<Record<string, unknown>>(env.PRIVATE, o.key)));
      return json({
        day,
        records: records.filter(Boolean).sort((a, b) => Number(b!.at) - Number(a!.at)),
        cursor: listed.truncated ? listed.cursor : null,
      });
    }
    throw new HttpError(404, 'Not found.');
  }

  if (method === 'POST' && (path === 'ban' || path === 'unban')) {
    const s = await requireWriter(req, env, now);
    if (!isAdmin(env, s.uid)) throw new HttpError(403, 'Admins only.');
    const body = await readBody<{ login?: unknown; reason?: unknown }>(req);
    const target = await resolveLogin(env, body.login);
    if (isAdmin(env, target.id)) throw new HttpError(422, "Admins can't be banned.");
    const key = `bans/${target.id}.json`;
    const by = { id: s.uid, login: s.login };
    if (path === 'ban') {
      const reason = typeof body.reason === 'string' ? body.reason.slice(0, 500) : '';
      await putJson(env.PRIVATE, key, { ...target, reason, by, at: now } satisfies Ban, { cacheControl: 'no-store' });
    } else {
      await env.PRIVATE.delete(key);
    }
    const day = new Date(now).toISOString().slice(0, 10);
    await putJson(env.PRIVATE, `audit/${day}/${ulid(now)}.json`, { at: now, user: by, action: path, type: 'user', target }, { cacheControl: 'no-store' });
    return json({ ok: true, action: path, user: target });
  }

  throw new HttpError(405, 'Method not allowed.');
}
