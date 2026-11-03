// Admin API tests (Phase 6): admin-only access, ban/unban effects, audit log.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.ts';
import { signSession } from '../worker/session.ts';
import { resetManifestCache } from '../worker/manifest.ts';
import { makeCtx, makeEnv, SECRET } from './fakes.ts';
import type { TestEnv } from './fakes.ts';

const DAY = 86_400_000;
const ADMIN = { uid: 1, login: 'admin' };
const ALICE = { uid: 100, login: 'alice' };
let env: TestEnv;

beforeEach(async () => {
  env = makeEnv();
  resetManifestCache();
  await env.content.put('logins/alice.json', JSON.stringify({ id: 100 }));
  await env.content.put('logins/admin.json', JSON.stringify({ id: 1 }));
});

async function call(method: string, path: string, user?: { uid: number; login: string }, body?: unknown) {
  const now = Date.now();
  const headers: Record<string, string> = { Origin: 'https://pydocs.org' };
  if (user) headers.Cookie = `pd_session=${await signSession({ ...user, ghc: now - 400 * DAY, iat: now, exp: now + DAY }, SECRET)}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const ctx = makeCtx();
  const res = await worker.fetch(new Request(`https://pydocs.org${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env as never, ctx as never);
  await ctx.settle();
  return { status: res.status, body: (await res.json()) as any };
}

test('admin endpoints refuse anonymous and non-admin users', async () => {
  assert.equal((await call('GET', '/api/admin/me')).status, 401);
  assert.equal((await call('GET', '/api/admin/me', ALICE)).status, 403);
  assert.equal((await call('POST', '/api/admin/ban', ALICE, { login: 'admin' })).status, 403);
  assert.deepEqual((await call('GET', '/api/admin/me', ADMIN)).body, { admin: true });
});

test('ban blocks writes, unban restores them; both are audited', async () => {
  const EX = '/api/s/builtins/len/examples';
  assert.equal((await call('POST', EX, ALICE, { body: 'len([1, 2])' })).status, 200);
  const ban = await call('POST', '/api/admin/ban', ADMIN, { login: '@Alice', reason: 'spam' });
  assert.equal(ban.status, 200);
  assert.equal((await call('POST', EX, ALICE, { body: 'more spam' })).status, 403);
  const bans = await call('GET', '/api/admin/bans', ADMIN);
  assert.deepEqual(bans.body.map((b: any) => [b.id, b.reason]), [[100, 'spam']]);
  assert.equal((await call('POST', '/api/admin/unban', ADMIN, { login: 'alice' })).status, 200);
  assert.equal((await call('POST', EX, ALICE, { body: 'back' })).status, 200);
  const day = new Date().toISOString().slice(0, 10);
  const audit = await call('GET', `/api/admin/audit?day=${day}`, ADMIN);
  assert.deepEqual(new Set(audit.body.records.map((r: any) => r.action)), new Set(['create', 'ban', 'unban']));
});

test('ban input checks: unknown user, bad login, admins cannot be banned', async () => {
  assert.equal((await call('POST', '/api/admin/ban', ADMIN, { login: 'nobody' })).status, 404);
  assert.equal((await call('POST', '/api/admin/ban', ADMIN, { login: '../x' })).status, 422);
  assert.equal((await call('POST', '/api/admin/ban', ADMIN, { login: 'admin' })).body.message, "Admins can't be banned.");
});

test('audit log pages by cursor', async () => {
  for (let i = 0; i < 45; i++) await env.private.put(`audit/2026-11-03/k${String(i).padStart(2, '0')}.json`, JSON.stringify({ at: i, action: 'create' }));
  const p1 = await call('GET', '/api/admin/audit?day=2026-11-03', ADMIN);
  assert.equal(p1.body.records.length, 40);
  assert.ok(p1.body.cursor);
  const p2 = await call('GET', `/api/admin/audit?day=2026-11-03&cursor=${p1.body.cursor}`, ADMIN);
  assert.deepEqual([p2.body.records.length, p2.body.cursor], [5, null]);
  assert.equal((await call('GET', '/api/admin/audit?day=bad', ADMIN)).status, 422);
});
