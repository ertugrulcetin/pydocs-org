// Nightly repair (PLAN.md §7.4, Phase 5): recomputes every user's
// contributions list (users/{id}.json) from the symbol docs, the source of
// truth. Side writes after a change are best-effort; this heals any that failed.
//
//   node scripts/rebuild-indexes.mjs           dry run (prints what would change)
//   node scripts/rebuild-indexes.mjs --write   writes changed user docs to R2
//
// Reads the symbols from site/.bake/snapshot.json (run scripts/snapshot.mjs
// first). Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SNAPSHOT = join(dirname(fileURLToPath(import.meta.url)), '..', '.bake', 'snapshot.json');
const BUCKET = 'pydocs-content';
const DATA = 'https://data.pydocs.org';
const WRITE = process.argv.includes('--write');
const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account } = process.env;
const api = (path) => `https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/${BUCKET}/objects${path}`;

async function listKeys(prefix) {
  const keys = [];
  let cursor;
  do {
    const url = new URL(api(''));
    url.searchParams.set('prefix', prefix);
    url.searchParams.set('per_page', '1000');
    if (cursor) url.searchParams.set('cursor', cursor);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const body = await res.json();
    if (!res.ok || !body.success) throw new Error(`list ${prefix}: HTTP ${res.status} ${JSON.stringify(body.errors)}`);
    keys.push(...body.result.map((o) => o.key));
    cursor = body.result.length && body.result_info?.is_truncated !== false ? body.result_info?.cursor : undefined;
  } while (cursor);
  return keys;
}

async function getJson(key) {
  const res = await fetch(`${DATA}/${key}?rebuild=${Date.now()}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`get ${key}: HTTP ${res.status}`);
  return res.json();
}

async function putJson(key, value) {
  const res = await fetch(api(`/${key}`), {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
    body: JSON.stringify(value),
  });
  if (!res.ok) throw new Error(`put ${key}: HTTP ${res.status} ${await res.text()}`);
}

/** Contributions per user id, from the symbol docs. Same order as the Worker appends them (oldest first). */
export function contributionsFromSymbols(symbols) {
  const byUser = new Map();
  const add = (author, c) => {
    if (!byUser.has(author.id)) byUser.set(author.id, { login: author.login, items: [] });
    byUser.get(author.id).items.push(c);
  };
  for (const doc of Object.values(symbols)) {
    for (const e of doc.examples) add(e.author, { type: 'example', symbol: doc.symbol, id: e.id, at: e.createdAt });
    for (const s of doc.seeAlsos) add(s.author, { type: 'seeAlso', symbol: doc.symbol, id: s.id, at: s.createdAt });
    for (const n of doc.notes) add(n.author, { type: 'note', symbol: doc.symbol, id: n.id, at: n.createdAt });
  }
  for (const u of byUser.values()) u.items.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
  return byUser;
}

async function main() {
  if (!token || !account) throw new Error('needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID');
  const { symbols, takenAt } = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
  const expected = contributionsFromSymbols(symbols);
  const userIds = new Set([...expected.keys(), ...(await listKeys('users/')).map((k) => Number(k.slice(6, -5)))]);

  let changed = 0;
  for (const id of userIds) {
    const cur = await getJson(`users/${id}.json`);
    const want = expected.get(id)?.items ?? [];
    const same = cur && JSON.stringify(cur.contributions.map((c) => c.id).sort()) === JSON.stringify(want.map((c) => c.id).sort());
    if (same) continue;
    // The user doc is missing (a failed side write) or its list drifted: rebuild it.
    const login = cur?.login ?? expected.get(id)?.login;
    const next = cur ? { ...cur, contributions: want } : { id, login, joinedAt: want[0]?.at ?? takenAt, lastSeenAt: want.at(-1)?.at ?? takenAt, contributions: want };
    console.log(`users/${id}.json (${login}): ${cur ? cur.contributions.length : 'missing'} -> ${want.length} contributions`);
    if (!cur && login) console.log(`  also logins/${login.toLowerCase()}.json`);
    changed++;
    if (WRITE) {
      await putJson(`users/${id}.json`, next);
      if (!cur && login) await putJson(`logins/${login.toLowerCase()}.json`, { id });
    }
  }
  console.log(`${userIds.size} users checked, ${changed} ${WRITE ? 'repaired' : 'would be repaired (dry run)'}.`);
}

// Run only as a script, so tests can import contributionsFromSymbols.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
