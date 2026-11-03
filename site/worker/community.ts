// Community content API (PLAN.md §7–8, Phase 4). One JSON doc per symbol in
// pydocs-content: symbols/{module}/{qualname}.json. Writes are read-modify-write
// with ETag retries; side writes (history, user contributions, activity, audit)
// run after the response and heal nightly (scripts/rebuild-indexes.ts).
//
// Permissions (§7.3): any logged-in user adds anything and edits any example
// (wiki-style, history kept); deleting an example or see-also, and editing or
// deleting a note, is for its author or an admin.
import type { AppEnv } from './env.ts';
import { HttpError, LIMITS, isAdmin, readBody, requireWriter, takeRateLimit } from './guards.ts';
import { json } from './http.ts';
import { knownSymbols, SYMBOL_ID } from './manifest.ts';
import { getJson, putJson, updateJson } from './r2json.ts';
import type { Session } from './session.ts';
import { isItemId, itemId, ulid } from './ulid.ts';
import { userKey } from './users.ts';
import type { UserDoc } from './users.ts';

export interface Author {
  id: number;
  login: string;
}
export interface Example {
  id: string;
  body: string;
  author: Author;
  editors: Author[];
  createdAt: number;
  updatedAt: number;
  /** "python-docs" for seeded doctest examples (Phase 7), else null. */
  source: string | null;
}
export interface SeeAlso {
  id: string;
  to: string;
  author: Author;
  createdAt: number;
}
export interface Note {
  id: string;
  body: string;
  author: Author;
  createdAt: number;
  updatedAt: number;
}
export interface SymbolDoc {
  symbol: string;
  examples: Example[];
  seeAlsos: SeeAlso[];
  notes: Note[];
  updatedAt: number;
}
export interface HistoryDoc {
  exampleId: string;
  symbol: string;
  versions: { body: string; editor: Author; at: number }[];
  deletedAt?: number;
}
export interface ActivityEvent {
  type: 'example' | 'seeAlso' | 'note';
  action: 'create' | 'edit' | 'delete';
  symbol: string;
  id: string;
  user: Author;
  at: number;
}

export const symbolKey = (sid: string) => `symbols/${sid}.json`;
export const historyKey = (exampleId: string) => `history/${exampleId}.json`;
export const ACTIVITY_KEY = 'activity/recent.json';
const ACTIVITY_MAX = 100;

export const emptyDoc = (sid: string): SymbolDoc => ({ symbol: sid, examples: [], seeAlsos: [], notes: [], updatedAt: 0 });

export interface WaitUntil {
  waitUntil(p: Promise<unknown>): void;
}

type Collection = 'examples' | 'see-alsos' | 'notes';
const PREFIX = { examples: 'ex', 'see-alsos': 'sa', notes: 'nt' } as const;
const TYPE = { examples: 'example', 'see-alsos': 'seeAlso', notes: 'note' } as const;

/** What a write did, for the side writes. */
interface Change {
  action: ActivityEvent['action'];
  collection: Collection;
  id: string;
  before: unknown;
  after: unknown;
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '');

export async function handleSymbolApi(
  req: Request,
  env: AppEnv,
  ctx: WaitUntil,
  segments: string[],
  now = Date.now(),
): Promise<Response> {
  const [module, qualname, collection, id, ...rest] = segments;
  const sid = `${module}/${qualname}`;
  if (rest.length || !SYMBOL_ID.test(sid) || !(await knownSymbols(env.ASSETS)).has(sid)) {
    throw new HttpError(404, 'Unknown symbol.');
  }

  if (collection === undefined) {
    if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed.');
    // Read path [B] (local dev, fallback). Production reads data.pydocs.org.
    return json((await getJson<SymbolDoc>(env.CONTENT, symbolKey(sid))) ?? emptyDoc(sid));
  }
  if (collection !== 'examples' && collection !== 'see-alsos' && collection !== 'notes') {
    throw new HttpError(404, 'Not found.');
  }
  if (id !== undefined && !isItemId(PREFIX[collection], id)) throw new HttpError(404, 'Not found.');

  const method = req.method;
  if (!((method === 'POST' && id === undefined) || ((method === 'PATCH' || method === 'DELETE') && id !== undefined))) {
    throw new HttpError(405, 'Method not allowed.');
  }
  if (method === 'PATCH' && collection === 'see-alsos') throw new HttpError(405, 'See-alsos cannot be edited.');

  const session = await requireWriter(req, env, now);
  const body = method === 'DELETE' ? {} : await readBody<Record<string, unknown>>(req);
  const author: Author = { id: session.uid, login: session.login };
  const admin = isAdmin(env, session.uid);
  const symbols = await knownSymbols(env.ASSETS);

  // Validate the input before counting it against the rate limit.
  if (method !== 'DELETE') validateInput(collection, body, sid, symbols);
  await takeRateLimit(env, session.uid, now);

  let change: Change | undefined;
  const doc = await updateJson<SymbolDoc>(env.CONTENT, symbolKey(sid), (current) => {
    const d: SymbolDoc = structuredClone(current ?? emptyDoc(sid));
    change = apply(d, collection, method, id, body, author, admin, now);
    if (!change) return undefined;
    d.updatedAt = now;
    return d;
  });

  if (change) ctx.waitUntil(sideWrites(env, sid, change, session, now));
  return json(doc ?? emptyDoc(sid));
}

function validateInput(collection: Collection, body: Record<string, unknown>, sid: string, symbols: Set<string>): void {
  if (collection === 'examples') {
    const b = text(body.body);
    if (!b.trim()) throw new HttpError(422, 'Whoops, looks like your example is blank.');
    if (b.length > LIMITS.exampleChars) throw new HttpError(413, `Your example is too long (max ${LIMITS.exampleChars.toLocaleString('en')} characters).`);
  } else if (collection === 'notes') {
    const b = text(body.body);
    if (!b.trim()) throw new HttpError(422, 'Whoops, looks like your note is empty.');
    if (b.length > LIMITS.noteChars) throw new HttpError(413, `Your note is too long (max ${LIMITS.noteChars.toLocaleString('en')} characters).`);
  } else {
    const to = text(body.to).trim();
    if (!SYMBOL_ID.test(to) || !symbols.has(to)) {
      throw new HttpError(422, `Couldn't find symbol "${to}". Use the full name, like os.path/join.`);
    }
    if (to === sid) throw new HttpError(422, "Sorry, a symbol can't see-also itself.");
  }
}

/** Applies one change to `d` in place; returns undefined for a no-op. Throws HttpError on bad input. */
function apply(
  d: SymbolDoc,
  collection: Collection,
  method: string,
  id: string | undefined,
  body: Record<string, unknown>,
  author: Author,
  admin: boolean,
  now: number,
): Change | undefined {
  const canManage = (owner: Author) => admin || owner.id === author.id;

  if (collection === 'examples') {
    if (method === 'POST') {
      const ex: Example = { id: itemId('ex', now), body: text(body.body), author, editors: [], createdAt: now, updatedAt: now, source: null };
      d.examples.push(ex);
      return { action: 'create', collection, id: ex.id, before: null, after: ex };
    }
    const i = d.examples.findIndex((e) => e.id === id);
    if (i < 0) {
      throw new HttpError(404, method === 'PATCH' ? "Couldn't find the example you're trying to update." : 'Not Found');
    }
    const before = d.examples[i]!;
    if (method === 'DELETE') {
      if (!canManage(before.author)) throw new HttpError(403, 'Not authorized to delete that example');
      d.examples.splice(i, 1);
      return { action: 'delete', collection, id: before.id, before, after: null };
    }
    const newBody = text(body.body);
    if (newBody === before.body) return undefined;
    // Wiki-style: any logged-in user may edit; each editor is listed once, most recent last.
    const editors = before.author.id === author.id ? before.editors : [...before.editors.filter((e) => e.id !== author.id), author];
    const after: Example = { ...before, body: newBody, editors, updatedAt: now };
    d.examples[i] = after;
    return { action: 'edit', collection, id: before.id, before, after };
  }

  if (collection === 'see-alsos') {
    if (method === 'POST') {
      const to = text(body.to).trim();
      if (d.seeAlsos.some((s) => s.to === to)) throw new HttpError(422, 'Sorry, that see also already exists.');
      const sa: SeeAlso = { id: itemId('sa', now), to, author, createdAt: now };
      d.seeAlsos.push(sa);
      return { action: 'create', collection, id: sa.id, before: null, after: sa };
    }
    const i = d.seeAlsos.findIndex((s) => s.id === id);
    if (i < 0) throw new HttpError(404, 'Not Found');
    const before = d.seeAlsos[i]!;
    if (!canManage(before.author)) throw new HttpError(403, "Sorry, you can't delete that see also.");
    d.seeAlsos.splice(i, 1);
    return { action: 'delete', collection, id: before.id, before, after: null };
  }

  // notes
  if (method === 'POST') {
    const n: Note = { id: itemId('nt', now), body: text(body.body), author, createdAt: now, updatedAt: now };
    d.notes.push(n);
    return { action: 'create', collection, id: n.id, before: null, after: n };
  }
  const i = d.notes.findIndex((n) => n.id === id);
  if (i < 0) throw new HttpError(404, `Note with id ${id} not found.`);
  const before = d.notes[i]!;
  if (!canManage(before.author)) throw new HttpError(403, 'You must be the author of this note.');
  if (method === 'DELETE') {
    d.notes.splice(i, 1);
    return { action: 'delete', collection, id: before.id, before, after: null };
  }
  const newBody = text(body.body);
  if (newBody === before.body) return undefined;
  const after: Note = { ...before, body: newBody, updatedAt: now };
  d.notes[i] = after;
  return { action: 'edit', collection, id: before.id, before, after };
}

/** Best-effort index writes after a change. Failures are logged; the nightly rebuild repairs them. */
async function sideWrites(env: AppEnv, sid: string, c: Change, s: Session, now: number): Promise<void> {
  const user: Author = { id: s.uid, login: s.login };
  const type = TYPE[c.collection];
  const tasks: Promise<unknown>[] = [];

  if (c.collection === 'examples') {
    tasks.push(
      updateJson<HistoryDoc>(env.CONTENT, historyKey(c.id), (h) => {
        const doc: HistoryDoc = h ?? { exampleId: c.id, symbol: sid, versions: [] };
        // A deleted example's text is removed from the public history; the audit log keeps it.
        if (c.action === 'delete') return { ...doc, versions: [], deletedAt: now };
        return { ...doc, versions: [...doc.versions, { body: (c.after as Example).body, editor: user, at: now }] };
      }),
    );
  }

  if (c.action !== 'edit') {
    const owner = ((c.before ?? c.after) as { author: Author }).author;
    tasks.push(
      updateJson<UserDoc>(env.CONTENT, userKey(owner.id), (u) => {
        if (!u) return undefined;
        const contributions =
          c.action === 'create'
            ? [...u.contributions, { type, symbol: sid, id: c.id, at: now }]
            : u.contributions.filter((x) => x.id !== c.id);
        return { ...u, contributions };
      }),
    );
  }

  tasks.push(
    updateJson<{ events: ActivityEvent[] }>(env.CONTENT, ACTIVITY_KEY, (a) => {
      const events = (a?.events ?? []).filter((e) => !(c.action === 'delete' && e.id === c.id));
      if (c.action !== 'delete') events.unshift({ type, action: c.action, symbol: sid, id: c.id, user, at: now });
      return { events: events.slice(0, ACTIVITY_MAX) };
    }),
  );

  const day = new Date(now).toISOString().slice(0, 10);
  tasks.push(
    putJson(
      env.PRIVATE,
      `audit/${day}/${ulid(now)}.json`,
      { at: now, user, action: c.action, type, symbol: sid, id: c.id, before: c.before, after: c.after },
      { cacheControl: 'no-store' },
    ),
  );

  const results = await Promise.allSettled(tasks);
  for (const r of results) if (r.status === 'rejected') console.error('side write failed:', sid, c.id, r.reason);
}
