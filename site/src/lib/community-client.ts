// Browser helpers for the community widgets (Phase 4).
import type { SymbolDoc } from '../../worker/community.ts';
import { highlightPython } from './highlight';

export type { Author, Example, Note, SeeAlso, SymbolDoc } from '../../worker/community.ts';

export const emptyDoc = (sid: string): SymbolDoc => ({ symbol: sid, examples: [], seeAlsos: [], notes: [], updatedAt: 0 });

export interface CookieUser {
  id: number;
  login: string;
}

/** The readable pd_user cookie (UI only; the server checks the signed session). */
export function currentUser(): CookieUser | null {
  const raw = document.cookie.match(/(?:^|;\s*)pd_user=([^;]+)/)?.[1];
  if (!raw) return null;
  try {
    const u = JSON.parse(atob(raw.replace(/-/g, '+').replace(/_/g, '/'))) as Partial<CookieUser>;
    return typeof u.id === 'number' && typeof u.login === 'string' ? { id: u.id, login: u.login } : null;
  } catch {
    return null;
  }
}

export const loginUrl = () => `/auth/login?return=${encodeURIComponent(location.pathname + location.search + location.hash)}`;
export const avatarUrl = (id: number, size = 64) => `https://avatars.githubusercontent.com/u/${id}?s=${size}`;

const storeKey = (sid: string) => `pd:doc:${sid}`;

/**
 * Latest community doc for a symbol. Production reads the public bucket on
 * data.pydocs.org (read path A, no Worker request); other hosts use the Worker
 * (read path B). A doc we just wrote ourselves (sessionStorage) wins if newer,
 * because the CDN may serve a copy up to a minute old.
 */
export async function loadLiveDoc(sid: string): Promise<SymbolDoc> {
  const url = location.hostname === 'pydocs.org' ? `https://data.pydocs.org/symbols/${sid}.json` : `/api/s/${sid}`;
  let live = emptyDoc(sid);
  const res = await fetch(url);
  if (res.ok) live = (await res.json()) as SymbolDoc;
  else if (res.status !== 404) throw new Error(`HTTP ${res.status}`);
  try {
    const mine = JSON.parse(sessionStorage.getItem(storeKey(sid)) ?? 'null') as SymbolDoc | null;
    if (mine && mine.updatedAt > live.updatedAt) return mine;
  } catch {
    // storage unavailable
  }
  return live;
}

export function rememberDoc(doc: SymbolDoc): void {
  try {
    sessionStorage.setItem(storeKey(doc.symbol), JSON.stringify(doc));
  } catch {
    // storage unavailable
  }
}

/** Calls the Worker API; resolves to the updated doc or throws with the server's message. */
export async function api(sid: string, method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<SymbolDoc> {
  const res = await fetch(`/api/s/${sid}${path}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  const data = (await res.json().catch(() => ({}))) as SymbolDoc & { message?: string; error?: string };
  if (res.status === 401) throw new Error('Your session has expired. Please log in again.');
  if (!res.ok) throw new Error(data.message ?? data.error ?? `Something went wrong (HTTP ${res.status}).`);
  rememberDoc(data);
  return data;
}

/** "3 days", "a few seconds" — like ClojureDocs' util/timeago. */
export function timeago(ms: number, now = Date.now()): string {
  const s = Math.max(0, (now - ms) / 1000);
  const units: [number, string][] = [
    [31536000, 'year'],
    [2592000, 'month'],
    [86400, 'day'],
    [3600, 'hour'],
    [60, 'minute'],
  ];
  for (const [secs, name] of units) {
    const n = Math.floor(s / secs);
    if (n >= 1) return `${n} ${name}${n > 1 ? 's' : ''}`;
  }
  return 'a few seconds';
}

/** Markdown -> sanitized HTML for notes (PLAN.md §11). Libraries load on first use. */
let markdown: Promise<{ parse: (s: string) => string | Promise<string> }> | undefined;

export async function renderMarkdown(src: string): Promise<string> {
  markdown ??= import('marked').then(({ Marked }) =>
    new Marked({ gfm: true, breaks: false }).use({
      renderer: {
        // Code blocks get the same highlighting as examples (ClojureDocs: pre.syntaxify).
        code({ text }: { text: string }) {
          return `<pre class="syntaxify">${highlightPython(text)}</pre>`;
        },
      },
    }),
  );
  const [md, { default: DOMPurify }] = await Promise.all([markdown, import('dompurify')]);
  const html = await md.parse(src);
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'code', 'pre', 'span', 'a', 'ul', 'ol', 'li', 'blockquote', 'h3', 'h4', 'h5', 'h6', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'del'],
    ALLOWED_ATTR: ['href', 'title', 'class'],
    ALLOWED_URI_REGEXP: /^(?:https?:|\/|#)/i,
  });
}

/** Keeps the Nav counts in the sidebar and mobile menu in sync. */
export function updateCounts(doc: SymbolDoc): void {
  const counts: Record<string, number> = { examples: doc.examples.length, 'see-also': doc.seeAlsos.length, notes: doc.notes.length };
  for (const [k, n] of Object.entries(counts)) {
    document.querySelectorAll<HTMLElement>(`[data-count="${k}"]`).forEach((el) => (el.textContent = String(n)));
    document.querySelectorAll<HTMLElement>(`[data-count-item="${k}"]`).forEach((el) => (el.hidden = k === 'notes' && n === 0));
  }
}
