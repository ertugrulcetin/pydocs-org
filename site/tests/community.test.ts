// Community API tests (Phase 4): permissions (§7.3), validation and ClojureDocs
// messages, limits, guards, and side writes (history, users, activity, audit).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.ts';
import { signSession } from '../worker/session.ts';
import { resetManifestCache } from '../worker/manifest.ts';
import { makeCtx, makeEnv, SECRET } from './fakes.ts';
import type { TestEnv } from './fakes.ts';

const DAY = 24 * 60 * 60 * 1000;
const OLD = Date.now() - 400 * DAY; // GitHub account created long ago
const ALICE = { uid: 100, login: 'alice' };
const BOB = { uid: 200, login: 'bob' };
const ADMIN = { uid: 1, login: 'admin' };

const cookieFor = async (u: { uid: number; login: string }, ghc = OLD) => {
  const now = Date.now();
  return `pd_session=${await signSession({ ...u, ghc, iat: now, exp: now + DAY }, SECRET)}`;
};

let env: TestEnv;
beforeEach(() => {
  env = makeEnv();
  resetManifestCache();
});

async function call(method: string, path: string, opts: { user?: { uid: number; login: string }; body?: unknown; origin?: string; ghc?: number; contentType?: string } = {}) {
  const headers: Record<string, string> = { Origin: opts.origin ?? 'https://pydocs.org' };
  if (opts.user) headers.Cookie = await cookieFor(opts.user, opts.ghc);
  if (opts.body !== undefined) headers['Content-Type'] = opts.contentType ?? 'application/json';
  const ctx = makeCtx();
  const res = await worker.fetch(
    new Request(`https://pydocs.org${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }),
    env as never,
    ctx as never,
  );
  await ctx.settle();
  return { status: res.status, body: (await res.json()) as any };
}

const EX = '/api/s/builtins/str.split/examples';

test('read path B returns an empty doc for a known symbol, 404 for unknown or bad ids', async () => {
  assert.deepEqual((await call('GET', '/api/s/builtins/len')).body, { symbol: 'builtins/len', examples: [], seeAlsos: [], notes: [], updatedAt: 0 });
  assert.equal((await call('GET', '/api/s/builtins/nope')).status, 404);
  assert.equal((await call('GET', '/api/s/..%2F..%2Fusers/1')).status, 404);
  assert.equal((await call('GET', '/api/s/builtins')).status, 404);
});

test('create example: stored, history, user contribution, activity, audit', async () => {
  await env.content.put('users/100.json', JSON.stringify({ id: 100, login: 'alice', joinedAt: 0, lastSeenAt: 0, contributions: [] }));
  const r = await call('POST', EX, { user: ALICE, body: { body: "'a,b'.split(',')\n# => ['a', 'b']" } });
  assert.equal(r.status, 200);
  const ex = r.body.examples[0];
  assert.match(ex.id, /^ex_[0-9A-Z]{26}$/);
  assert.deepEqual(ex.author, { id: 100, login: 'alice' });
  assert.deepEqual(env.content.read('symbols/builtins/str.split.json'), r.body);
  assert.equal(env.content.read(`history/${ex.id}.json`).versions.length, 1);
  assert.equal(env.content.read('users/100.json').contributions[0].id, ex.id);
  assert.equal(env.content.read('activity/recent.json').events[0].action, 'create');
  assert.equal(env.private.keys('audit/').length, 1);
  assert.equal(env.private.keys('ratelimit/100/').length, 2);
});

test('example validation uses ClojureDocs messages and limits', async () => {
  assert.deepEqual((await call('POST', EX, { user: ALICE, body: { body: '   ' } })).body, { message: 'Whoops, looks like your example is blank.' });
  const long = await call('POST', EX, { user: ALICE, body: { body: 'x'.repeat(10_001) } });
  assert.equal(long.status, 413);
  assert.equal((await call('POST', EX, { user: ALICE, body: { body: 'x'.repeat(10_000) } })).status, 200);
});

test('wiki-style editing: anyone edits, editors listed once, history grows; only author/admin deletes', async () => {
  const ex = (await call('POST', EX, { user: ALICE, body: { body: 'v1' } })).body.examples[0];
  const e1 = await call('PATCH', `${EX}/${ex.id}`, { user: BOB, body: { body: 'v2' } });
  assert.equal(e1.body.examples[0].body, 'v2');
  await call('PATCH', `${EX}/${ex.id}`, { user: BOB, body: { body: 'v3' } });
  await call('PATCH', `${EX}/${ex.id}`, { user: ALICE, body: { body: 'v4' } });
  const doc = env.content.read('symbols/builtins/str.split.json');
  assert.deepEqual(doc.examples[0].editors, [{ id: 200, login: 'bob' }]);
  assert.deepEqual(env.content.read(`history/${ex.id}.json`).versions.map((v: any) => v.body), ['v1', 'v2', 'v3', 'v4']);
  // unchanged body is a no-op
  const etag = env.content.objects.get('symbols/builtins/str.split.json')!.etag;
  await call('PATCH', `${EX}/${ex.id}`, { user: BOB, body: { body: 'v4' } });
  assert.equal(env.content.objects.get('symbols/builtins/str.split.json')!.etag, etag);
  // delete permissions
  const d1 = await call('DELETE', `${EX}/${ex.id}`, { user: BOB });
  assert.deepEqual([d1.status, d1.body.message], [403, 'Not authorized to delete that example']);
  assert.equal((await call('DELETE', `${EX}/${ex.id}`, { user: ALICE })).body.examples.length, 0);
  const h = env.content.read(`history/${ex.id}.json`);
  assert.deepEqual([h.versions.length, typeof h.deletedAt], [0, 'number']);
  assert.equal((await call('PATCH', `${EX}/${ex.id}`, { user: BOB, body: { body: 'x' } })).body.message, "Couldn't find the example you're trying to update.");
});

test('admin can delete anything', async () => {
  const ex = (await call('POST', EX, { user: ALICE, body: { body: 'spam' } })).body.examples[0];
  assert.equal((await call('DELETE', `${EX}/${ex.id}`, { user: ADMIN })).status, 200);
});

test('see-alsos: unknown target, self, duplicate, delete permissions', async () => {
  const SA = '/api/s/builtins/str.split/see-alsos';
  assert.equal((await call('POST', SA, { user: ALICE, body: { to: 'builtins/nope' } })).status, 422);
  assert.equal((await call('POST', SA, { user: ALICE, body: { to: 'builtins/str.split' } })).body.message, "Sorry, a symbol can't see-also itself.");
  const sa = (await call('POST', SA, { user: ALICE, body: { to: 're/split' } })).body.seeAlsos[0];
  assert.equal(sa.to, 're/split');
  assert.equal((await call('POST', SA, { user: BOB, body: { to: 're/split' } })).body.message, 'Sorry, that see also already exists.');
  assert.equal((await call('DELETE', `${SA}/${sa.id}`, { user: BOB })).body.message, "Sorry, you can't delete that see also.");
  assert.equal((await call('DELETE', `${SA}/${sa.id}`, { user: ALICE })).body.seeAlsos.length, 0);
  assert.equal((await call('PATCH', `${SA}/${sa.id}`, { user: ALICE, body: { to: 'x' } })).status, 405);
});

test('notes: empty, only author edits/deletes', async () => {
  const NT = '/api/s/builtins/len/notes';
  assert.equal((await call('POST', NT, { user: ALICE, body: { body: '' } })).body.message, 'Whoops, looks like your note is empty.');
  const n = (await call('POST', NT, { user: ALICE, body: { body: 'Use `len()`.' } })).body.notes[0];
  assert.equal((await call('PATCH', `${NT}/${n.id}`, { user: BOB, body: { body: 'hijack' } })).body.message, 'You must be the author of this note.');
  assert.equal((await call('PATCH', `${NT}/${n.id}`, { user: ALICE, body: { body: 'edited' } })).body.notes[0].body, 'edited');
  assert.equal((await call('DELETE', `${NT}/${n.id}`, { user: BOB })).status, 403);
  assert.equal((await call('DELETE', `${NT}/${n.id}`, { user: ALICE })).body.notes.length, 0);
});

test('guards: login, origin, content type, account age, ban, malformed ids', async () => {
  assert.equal((await call('POST', EX, { body: { body: 'x' } })).status, 401);
  assert.equal((await call('POST', EX, { user: ALICE, body: { body: 'x' }, origin: 'https://evil.com' })).status, 403);
  assert.equal((await call('POST', EX, { user: ALICE, body: { body: 'x' }, contentType: 'text/plain' })).status, 415);
  const young = await call('POST', EX, { user: ALICE, body: { body: 'x' }, ghc: Date.now() - 2 * DAY });
  assert.equal(young.body.message, 'Your GitHub account must be at least 7 days old to contribute.');
  await env.private.put('bans/100.json', '{}');
  assert.equal((await call('POST', EX, { user: ALICE, body: { body: 'x' } })).status, 403);
  assert.equal((await call('DELETE', `${EX}/not-an-id`, { user: BOB })).status, 404);
  assert.equal(env.content.keys('symbols/').length, 0);
});

test('rate limit: 20 writes per hour, then 429; invalid input does not count', async () => {
  for (let i = 0; i < 5; i++) await call('POST', EX, { user: BOB, body: { body: '' } });
  for (let i = 0; i < 20; i++) assert.equal((await call('POST', EX, { user: BOB, body: { body: `e${i}` } })).status, 200);
  assert.equal((await call('POST', EX, { user: BOB, body: { body: 'one more' } })).status, 429);
  // admins are exempt
  for (let i = 0; i < 25; i++) assert.equal((await call('POST', EX, { user: ADMIN, body: { body: `a${i}` } })).status, 200);
});

test('concurrent write to the same symbol is retried, nothing lost', async () => {
  await call('POST', EX, { user: ALICE, body: { body: 'first' } });
  const key = 'symbols/builtins/str.split.json';
  env.content.raceOnNextGet = (k) => {
    if (k !== key) return;
    const d = env.content.read(key);
    d.notes.push({ id: 'nt_X', body: 'racer', author: { id: 9, login: 'r' }, createdAt: 0, updatedAt: 0 });
    void env.content.put(key, JSON.stringify(d));
  };
  const r = await call('POST', EX, { user: BOB, body: { body: 'second' } });
  assert.deepEqual([r.body.examples.length, r.body.notes.length], [2, 1]);
});

test('read path B (/api/r): allow-listed public keys only', async () => {
  await env.content.put('users/100.json', JSON.stringify({ id: 100, login: 'alice', joinedAt: 0, lastSeenAt: 0, contributions: [] }));
  const get = async (key: string) => {
    const res = await worker.fetch(new Request(`https://pydocs.org/api/r/${key}`), env as never, makeCtx() as never);
    return res.status;
  };
  assert.equal(await get('users/100.json'), 200);
  assert.equal(await get('users/999.json'), 404);
  assert.equal(await get('activity/recent.json'), 404);
  for (const bad of ['bans/100.json', 'users/../bans/1.json', 'audit/2026-11-03/x.json', 'users/100', 'symbols/a/b/c/d.json']) {
    assert.equal(await get(bad), 404, bad);
  }
});

test('per-symbol limits keep docs small (50 examples)', async () => {
  const author = { id: 9, login: 'x' };
  const doc = { symbol: 'builtins/str.split', seeAlsos: [], notes: [], updatedAt: 1,
    examples: Array.from({ length: 50 }, (_, i) => ({ id: `ex_01JBX${String(i).padStart(21, '0')}`, body: 'x', author, editors: [], createdAt: 1, updatedAt: 1, source: null })) };
  await env.content.put('symbols/builtins/str.split.json', JSON.stringify(doc));
  const r = await call('POST', EX, { user: ALICE, body: { body: 'one more' } });
  assert.deepEqual([r.status, r.body.message], [422, 'This symbol already has 50 examples. Please improve an existing one instead.']);
});
