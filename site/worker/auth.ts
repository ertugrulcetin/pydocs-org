// GitHub login (PLAN.md §8, Phase 3):
//   GET /auth/login?return=/path  -> state cookie, redirect to GitHub (no scopes: public profile only)
//   GET /auth/callback            -> check state, exchange code, GET /user, upsert user, set session
//   GET /auth/logout              -> clear cookies, redirect to /
// The GitHub token is used for one /user call and then dropped.
import type { AppEnv } from './env.ts';
import { clearCookie, htmlMessage, parseCookies, redirect, safeReturn, setCookie } from './http.ts';
import { randomToken, safeEqual, signSession, userCookieValue, SESSION_TTL_MS } from './session.ts';
import { upsertUser } from './users.ts';

export const STATE_COOKIE = 'pd_oauth';
export const SESSION_COOKIE = 'pd_session';
export const USER_COOKIE = 'pd_user';
const STATE_TTL_S = 10 * 60;

const callbackUrl = (req: Request) => `${new URL(req.url).origin}/auth/callback`;

export function login(req: Request, env: AppEnv): Response {
  const ret = safeReturn(new URL(req.url).searchParams.get('return'));
  if (!env.GITHUB_CLIENT_ID) return htmlMessage('Login is not available', 'GitHub login is not configured yet.', ret, 503);
  const state = randomToken();
  const gh = new URL('https://github.com/login/oauth/authorize');
  gh.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
  gh.searchParams.set('redirect_uri', callbackUrl(req));
  gh.searchParams.set('state', state);
  gh.searchParams.set('scope', '');
  gh.searchParams.set('allow_signup', 'true');
  return redirect(gh.toString(), [
    setCookie(STATE_COOKIE, `${state}.${encodeURIComponent(ret)}`, { maxAge: STATE_TTL_S, path: '/auth' }),
  ]);
}

interface GitHubUser {
  id: number;
  login: string;
  created_at: string;
}

export async function callback(req: Request, env: AppEnv, fetchFn: typeof fetch = fetch, now = Date.now()): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const raw = parseCookies(req)[STATE_COOKIE] ?? '';
  const dot = raw.indexOf('.');
  const expected = dot > 0 ? raw.slice(0, dot) : '';
  let ret = '/';
  try {
    ret = safeReturn(dot > 0 ? decodeURIComponent(raw.slice(dot + 1)) : '/');
  } catch {
    // malformed cookie: keep "/"
  }
  const fail = (msg: string, status = 400) => {
    const res = htmlMessage('Login failed', msg, ret, status);
    res.headers.append('Set-Cookie', clearCookie(STATE_COOKIE, '/auth'));
    return res;
  };

  if (url.searchParams.get('error')) return fail('GitHub login was cancelled.');
  if (!code || !state || !expected || !safeEqual(state, expected)) return fail('Your login link expired. Please try again.');

  const tokenRes = await fetchFn('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'pydocs' },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: callbackUrl(req),
    }),
  });
  const tokenBody = (await tokenRes.json().catch(() => ({}))) as { access_token?: string; error?: string };
  const token = tokenRes.ok ? tokenBody.access_token : undefined;
  if (!token) {
    // GitHub's error code is safe to show and log (e.g. bad_verification_code, incorrect_client_credentials).
    const why = tokenBody.error ?? `HTTP ${tokenRes.status}`;
    console.error('oauth: token exchange failed:', why);
    return fail(`GitHub did not accept the login (${why}). Please try again.`, 502);
  }

  const userRes = await fetchFn('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'pydocs' },
  });
  if (!userRes.ok) {
    console.error('oauth: GET /user failed:', userRes.status);
    return fail(`Could not read your GitHub profile (HTTP ${userRes.status}). Please try again.`, 502);
  }
  const gh = (await userRes.json()) as GitHubUser;
  if (typeof gh.id !== 'number' || typeof gh.login !== 'string') return fail('Unexpected GitHub profile.', 502);

  await upsertUser(env.CONTENT, gh.id, gh.login, now);
  console.log('oauth: login ok', gh.id, gh.login);

  const session = await signSession(
    { uid: gh.id, login: gh.login, ghc: Date.parse(gh.created_at) || now, iat: now, exp: now + SESSION_TTL_MS },
    env.SESSION_SECRET,
  );
  const maxAge = SESSION_TTL_MS / 1000;
  return redirect(ret, [
    clearCookie(STATE_COOKIE, '/auth'),
    setCookie(SESSION_COOKIE, session, { maxAge }),
    setCookie(USER_COOKIE, userCookieValue(gh.id, gh.login), { maxAge, httpOnly: false }),
  ]);
}

export function logout(): Response {
  return redirect('/', [clearCookie(SESSION_COOKIE), clearCookie(USER_COOKIE)]);
}
