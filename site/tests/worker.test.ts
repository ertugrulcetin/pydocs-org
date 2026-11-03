// Worker unit tests (Phase 3). Run: npm test (node:test, Node 26 runs TS directly).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signSession, verifySession, SESSION_TTL_MS } from '../worker/session.ts';
import { safeReturn, parseCookies } from '../worker/http.ts';
import { updateJson, ConflictError } from '../worker/r2json.ts';
import { upsertUser } from '../worker/users.ts';
import { login, callback, logout } from '../worker/auth.ts';
import worker from '../worker/index.ts';
import type { AppEnv } from '../worker/env.ts';

import { FakeR2, SECRET } from './fakes.ts';

const makeEnv = (content = new FakeR2()): AppEnv & { content: FakeR2 } =>
  ({
    GITHUB_CLIENT_ID: 'cid',
    GITHUB_CLIENT_SECRET: 'csecret',
    SESSION_SECRET: SECRET,
    ADMIN_GITHUB_IDS: '8271291',
    CONTENT: content as unknown as R2Bucket,
    PRIVATE: new FakeR2() as unknown as R2Bucket,
    ASSETS: {} as Fetcher,
    content,
  }) as AppEnv & { content: FakeR2 };

test('session: sign, verify, tamper, expire, wrong secret', async () => {
  const now = 1_700_000_000_000;
  const s = { uid: 7, login: 'octo', ghc: now - 1e10, iat: now, exp: now + SESSION_TTL_MS };
  const tok = await signSession(s, SECRET);
  assert.deepEqual(await verifySession(tok, SECRET, now), s);
  assert.equal(await verifySession(tok, 'other-secret', now), null);
  const [body, mac] = tok.split('.');
  const forged = Buffer.from(JSON.stringify({ ...s, uid: 1 })).toString('base64url');
  assert.equal(await verifySession(`${forged}.${mac}`, SECRET, now), null);
  assert.equal(await verifySession(`${body}.`, SECRET, now), null);
  assert.equal(await verifySession(tok, SECRET, s.exp + 1), null);
  assert.equal(await verifySession(undefined, SECRET, now), null);
  assert.equal(await verifySession('garbage', SECRET, now), null);
});

test('safeReturn allows only same-site relative paths', () => {
  assert.equal(safeReturn('/builtins/len#examples'), '/builtins/len#examples');
  assert.equal(safeReturn('/search?q=a'), '/search?q=a');
  for (const bad of [null, '', 'https://evil.com', '//evil.com', '/\\evil.com', 'javascript:alert(1)', '/auth/login', '/a\nb']) {
    assert.equal(safeReturn(bad), '/', String(bad));
  }
});

test('updateJson: create-if-absent, update, retry on conflict, give up', async () => {
  const r2 = new FakeR2();
  const b = r2 as unknown as R2Bucket;
  assert.deepEqual(await updateJson<{ n: number }>(b, 'k', (c) => ({ n: (c?.n ?? 0) + 1 })), { n: 1 });
  assert.deepEqual(await updateJson<{ n: number }>(b, 'k', (c) => ({ n: (c?.n ?? 0) + 1 })), { n: 2 });
  // a concurrent write lands between our read and our put: we must retry and keep both increments
  r2.raceOnNextGet = (key) => void r2.put(key, JSON.stringify({ n: 100 }));
  assert.deepEqual(await updateJson<{ n: number }>(b, 'k', (c) => ({ n: (c?.n ?? 0) + 1 })), { n: 101 });
  // no change -> no write
  const etag = r2.objects.get('k')!.etag;
  await updateJson(b, 'k', () => undefined);
  assert.equal(r2.objects.get('k')!.etag, etag);
  // always conflicting -> ConflictError
  const always = new FakeR2();
  always.put = async () => null;
  await assert.rejects(updateJson(always as unknown as R2Bucket, 'x', () => ({})), ConflictError);
});

test('upsertUser: create, refresh, rename cleans the old login key', async () => {
  const r2 = new FakeR2();
  const b = r2 as unknown as R2Bucket;
  await upsertUser(b, 42, 'Alice', 1000);
  assert.deepEqual(r2.read('users/42.json'), { id: 42, login: 'Alice', joinedAt: 1000, lastSeenAt: 1000, contributions: [] });
  assert.deepEqual(r2.read('logins/alice.json'), { id: 42 });
  await upsertUser(b, 42, 'alice2', 2000);
  assert.equal(r2.read('users/42.json').joinedAt, 1000);
  assert.equal(r2.read('users/42.json').lastSeenAt, 2000);
  assert.equal(r2.read('logins/alice.json'), undefined);
  assert.deepEqual(r2.read('logins/alice2.json'), { id: 42 });
});

test('login: redirects to GitHub with state cookie and safe return', () => {
  const res = login(new Request('https://pydocs.org/auth/login?return=/os.path/join'), makeEnv());
  assert.equal(res.status, 302);
  const gh = new URL(res.headers.get('Location')!);
  assert.equal(gh.origin + gh.pathname, 'https://github.com/login/oauth/authorize');
  assert.equal(gh.searchParams.get('client_id'), 'cid');
  assert.equal(gh.searchParams.get('redirect_uri'), 'https://pydocs.org/auth/callback');
  assert.equal(gh.searchParams.get('scope'), '');
  const cookie = res.headers.getSetCookie()[0]!;
  assert.match(cookie, /^pd_oauth=[A-Za-z0-9_-]+\.%2Fos\.path%2Fjoin; Path=\/auth; Max-Age=600; Secure; SameSite=Lax; HttpOnly$/);
  assert.equal(cookie.split('=')[1]!.split('.')[0], gh.searchParams.get('state'));
});

const fakeGitHub = (user = { id: 42, login: 'octo', created_at: '2015-01-01T00:00:00Z' }) => {
  const calls: string[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (url === 'https://github.com/login/oauth/access_token') {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.client_secret, 'csecret');
      return Response.json(body.code === 'good' ? { access_token: 'tok' } : { error: 'bad_verification_code' });
    }
    if (url === 'https://api.github.com/user') {
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer tok');
      return Response.json(user);
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  return { f, calls };
};

const callbackReq = (qs: string, cookie: string) =>
  new Request(`https://pydocs.org/auth/callback?${qs}`, { headers: { Cookie: cookie } });

test('callback: happy path sets session + user cookies and stores the user', async () => {
  const env = makeEnv();
  const { f } = fakeGitHub();
  const res = await callback(callbackReq('code=good&state=abc', 'pd_oauth=abc.%2Fbuiltins%2Flen'), env, f, 5000);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('Location'), '/builtins/len');
  const cookies = res.headers.getSetCookie();
  assert.ok(cookies.some((c) => c.startsWith('pd_oauth=;') && c.includes('Max-Age=0')));
  const session = cookies.find((c) => c.startsWith('pd_session='))!;
  assert.match(session, /HttpOnly/);
  const user = cookies.find((c) => c.startsWith('pd_user='))!;
  assert.doesNotMatch(user, /HttpOnly/);
  const s = await verifySession(session.split(';')[0]!.slice('pd_session='.length), SECRET, 5000);
  assert.equal(s?.uid, 42);
  assert.equal(s?.ghc, Date.parse('2015-01-01T00:00:00Z'));
  assert.equal(env.content.read('users/42.json').login, 'octo');
});

test('callback: rejects bad or missing state, GitHub errors, and cancel', async () => {
  const env = makeEnv();
  const { f, calls } = fakeGitHub();
  assert.equal((await callback(callbackReq('code=good&state=abc', 'pd_oauth=xyz.%2F'), env, f)).status, 400);
  assert.equal((await callback(callbackReq('code=good&state=abc', ''), env, f)).status, 400);
  assert.equal(calls.length, 0, 'no GitHub call without a valid state');
  assert.equal((await callback(callbackReq('error=access_denied&state=abc', 'pd_oauth=abc.%2F'), env, f)).status, 400);
  assert.equal((await callback(callbackReq('code=bad&state=abc', 'pd_oauth=abc.%2F'), env, f)).status, 502);
  assert.equal(env.content.objects.size, 0);
  // an open-redirect attempt stored in the cookie falls back to "/"
  const res = await callback(callbackReq('code=good&state=abc', 'pd_oauth=abc.https%3A%2F%2Fevil.com'), env, f);
  assert.equal(res.headers.get('Location'), '/');
});

test('logout clears both cookies', () => {
  const res = logout();
  assert.equal(res.headers.get('Location'), '/');
  const c = res.headers.getSetCookie();
  assert.ok(c.some((x) => x.startsWith('pd_session=;') && x.includes('Max-Age=0')));
  assert.ok(c.some((x) => x.startsWith('pd_user=;') && x.includes('Max-Age=0')));
});

test('router: /api/me, unknown routes, errors become JSON', async () => {
  const env = makeEnv();
  const now = Date.now();
  const tok = await signSession({ uid: 9, login: 'me', ghc: 0, iat: now, exp: now + 60_000 }, SECRET);
  const call = (path: string, cookie = '') =>
    worker.fetch(new Request(`https://pydocs.org${path}`, { headers: { Cookie: cookie } }), env as never, {} as never);
  assert.deepEqual(await (await call('/api/me', `pd_session=${tok}`)).json(), { id: 9, login: 'me' });
  assert.equal((await call('/api/me')).status, 401);
  assert.equal((await call('/api/nope')).status, 404);
  assert.equal((await call('/api/health')).status, 200);
});

test('parseCookies', () => {
  assert.deepEqual(parseCookies(new Request('https://x', { headers: { Cookie: 'a=1; b=x.y=z' } })), { a: '1', b: 'x.y=z' });
});
