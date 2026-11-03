// Small HTTP helpers: JSON/HTML responses, redirects, cookies.

const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

export const json = (body: unknown, status = 200, headers: HeadersInit = {}): Response =>
  Response.json(body, { status, headers: { ...SECURITY_HEADERS, ...headers } });

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Minimal error page for auth failures (the user lands here from GitHub). */
export const htmlMessage = (title: string, message: string, back: string, status = 400): Response =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
      `<title>${escapeHtml(title)} | PyDocs</title><link rel="stylesheet" href="/css/bootstrap.min.css"><link rel="stylesheet" href="/css/clojuredocs-app.css"></head>` +
      `<body><div class="container"><div class="row"><div class="col-md-10 col-md-offset-1">` +
      `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><p><a href="${escapeHtml(back)}">Go back</a></p>` +
      `</div></div></div></body></html>`,
    {
      status,
      headers: {
        ...SECURITY_HEADERS,
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': "default-src 'none'; style-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      },
    },
  );

export const redirect = (location: string, cookies: string[] = []): Response => {
  const headers = new Headers({ ...SECURITY_HEADERS, Location: location });
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(null, { status: 302, headers });
};

export const parseCookies = (req: Request): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const part of (req.headers.get('Cookie') ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
};

export interface CookieOptions {
  maxAge: number;
  httpOnly?: boolean;
  path?: string;
}

export const setCookie = (name: string, value: string, { maxAge, httpOnly = true, path = '/' }: CookieOptions): string =>
  `${name}=${value}; Path=${path}; Max-Age=${maxAge}; Secure; SameSite=Lax${httpOnly ? '; HttpOnly' : ''}`;

export const clearCookie = (name: string, path = '/'): string => setCookie(name, '', { maxAge: 0, path });

/**
 * Where to go after login: only same-site relative paths (PLAN.md §11, open
 * redirect). Anything else, and auth URLs themselves, fall back to "/".
 */
export const safeReturn = (raw: string | null | undefined): string => {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/';
  if (/[\u0000-\u001f\\]/.test(raw) || raw.startsWith('/auth/')) return '/';
  return raw;
};
