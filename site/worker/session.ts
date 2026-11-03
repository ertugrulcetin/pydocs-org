// Stateless session cookie (PLAN.md §8):
//   pd_session = base64url(JSON payload) "." base64url(HMAC-SHA256(secret, first part))
// Verified with WebCrypto, which compares in constant time.

export interface Session {
  /** GitHub user id. */
  uid: number;
  login: string;
  /** GitHub account creation time (ms), for the minimum account age on writes. */
  ghc: number;
  /** Issued at / expires at (ms). */
  iat: number;
  exp: number;
}

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const enc = new TextEncoder();
const dec = new TextDecoder();

export const b64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const fromB64url = (s: string): Uint8Array => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
};

const key = (secret: string, usage: 'sign' | 'verify') =>
  crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);

export async function signSession(s: Session, secret: string): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(s)));
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', await key(secret, 'sign'), enc.encode(body)));
  return `${body}.${b64url(mac)}`;
}

/** Returns the session if the signature is valid and it has not expired, else null. */
export async function verifySession(token: string | undefined, secret: string, now = Date.now()): Promise<Session | null> {
  if (!token || !secret) return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  try {
    const ok = await crypto.subtle.verify('HMAC', await key(secret, 'verify'), fromB64url(token.slice(dot + 1)), enc.encode(body));
    if (!ok) return null;
    const s = JSON.parse(dec.decode(fromB64url(body))) as Session;
    if (typeof s.uid !== 'number' || typeof s.login !== 'string' || typeof s.exp !== 'number' || s.exp <= now) return null;
    return s;
  } catch {
    return null;
  }
}

/** JS-readable cookie for the navbar: base64url(JSON {id, login}). Not trusted by the server. */
export const userCookieValue = (id: number, login: string): string => b64url(enc.encode(JSON.stringify({ id, login })));

/** Random URL-safe token (OAuth state). */
export const randomToken = (bytes = 32): string => b64url(crypto.getRandomValues(new Uint8Array(bytes)));

/** Constant-time string compare for short tokens. */
export const safeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};
