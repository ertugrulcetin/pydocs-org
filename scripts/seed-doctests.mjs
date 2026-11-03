#!/usr/bin/env node
// Seeds examples from the Python docs' >>> snippets (PLAN.md Phase 7, Q4, Q12):
// every symbol that has a doctest and no example yet gets one example, by the
// system user "python-docs", marked source "python-docs" ("from the Python docs").
// Code in the Python docs is Zero-Clause BSD, so reuse is fine.
//
//   node scripts/seed-doctests.mjs            dry run: prints what it would write
//   node scripts/seed-doctests.mjs --write    writes to R2 (pydocs-content)
//
// --write needs CLOUDFLARE_API_TOKEN (R2 write) and CLOUDFLARE_ACCOUNT_ID.
// Idempotent: symbols that already have any example are skipped. Every key it
// writes is listed in scripts/seed-manifest-<time>.json, for rollback.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOCTESTS = join(ROOT, 'data/py-3.15/doctests');
const SYMBOLS = join(ROOT, 'data/py-3.15/symbols');
const BUCKET = 'pydocs-content';
const DATA = 'https://data.pydocs.org';
const WRITE = process.argv.includes('--write');
const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account } = process.env;
export const SYSTEM = { id: 0, login: 'python-docs' };
const MAX_CHARS = 10_000;
const REQUESTS_PER_SECOND = 4; // Cloudflare API limit is 1,200 per 5 minutes

// ---- ULIDs, same format as site/worker/ulid.ts ----
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function ulid(now) {
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[t % 32] + time;
    t = Math.floor(t / 32);
  }
  return time + [...randomBytes(16)].map((b) => ALPHABET[b % 32]).join('');
}

// ---- pick one snippet per symbol: its own docs entry first, then the most specific prose ----
function pickSnippets() {
  const known = new Set(readdirSync(SYMBOLS).flatMap((f) => JSON.parse(readFileSync(join(SYMBOLS, f), 'utf8')).map((s) => s.id)));
  const picks = new Map();
  for (const f of readdirSync(DOCTESTS).sort()) {
    const d = JSON.parse(readFileSync(join(DOCTESTS, f), 'utf8'));
    for (const [sid, snippets] of Object.entries(d.symbols)) {
      if (!known.has(sid)) continue;
      // An example for X must use X: snippets that never mention the symbol's own name
      // (e.g. a get_annotations demo attached to annotations_to_string) are skipped.
      const name = sid.slice(sid.indexOf('/') + 1).split('.').pop();
      const uses = new RegExp(`(?<![\\w])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w])`);
      const relevant = snippets.filter((s) => uses.test(s.code));
      const own = relevant.filter((s) => s.from !== 'prose');
      const best = own[0] ?? [...relevant].sort((a, b) => (a.targets ?? 1) - (b.targets ?? 1))[0];
      if (best && best.code.trim() && best.code.length <= MAX_CHARS) picks.set(sid, best);
    }
  }
  return picks;
}

// ---- R2 via the Cloudflare REST API (writes) and data.pydocs.org (reads) ----
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
  const res = await fetch(`${DATA}/${key}?seed=${Date.now()}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`get ${key}: HTTP ${res.status}`);
  return res.json();
}

let lastRequest = 0;
async function putJson(key, value) {
  const wait = lastRequest + 1000 / REQUESTS_PER_SECOND - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequest = Date.now();
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(api(`/${key}`), {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' },
      body: JSON.stringify(value),
    });
    if (res.ok) return;
    if (attempt >= 4 || (res.status < 500 && res.status !== 429)) throw new Error(`put ${key}: HTTP ${res.status} ${await res.text()}`);
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
}

async function main() {
  const picks = pickSnippets();
  const canRead = Boolean(token && account);
  if (WRITE && !canRead) throw new Error('--write needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID');

  // Symbols that already have content: skip if they have any example.
  const existingKeys = canRead ? new Set(await listKeys('symbols/')) : new Set();
  const existing = new Map();
  for (const key of existingKeys) {
    const sid = key.slice('symbols/'.length, -'.json'.length);
    if (picks.has(sid)) existing.set(sid, await getJson(key));
  }

  const now = Date.now();
  const plan = [];
  for (const [sid, snip] of picks) {
    const doc = existing.get(sid) ?? { symbol: sid, examples: [], seeAlsos: [], notes: [], updatedAt: 0 };
    if (doc.examples.length > 0) continue;
    const ex = { id: `ex_${ulid(now)}`, body: snip.code, author: SYSTEM, editors: [], createdAt: now, updatedAt: now, source: 'python-docs' };
    plan.push({ sid, ex, doc: { ...doc, examples: [ex], updatedAt: now } });
  }

  const bytes = plan.reduce((n, p) => n + JSON.stringify(p.doc).length, 0);
  const puts = plan.length * 2 + 2;
  console.log(`${picks.size} symbols have a doctest; ${existingKeys.size} symbol docs exist in R2 (${canRead ? 'checked' : 'not checked: no token'}).`);
  console.log(`Would seed ${plan.length} examples (${(bytes / 1024).toFixed(0)} KiB of symbol docs), ${puts} R2 writes, about ${Math.ceil(puts / REQUESTS_PER_SECOND / 60)} min.`);
  for (const p of plan.filter((_, i) => i % Math.max(1, Math.floor(plan.length / 3)) === 0).slice(0, 3)) {
    console.log(`\n--- ${p.sid}\n${p.ex.body.split('\n').slice(0, 8).join('\n')}`);
  }
  if (!WRITE) {
    console.log('\nDry run only. Re-run with --write to write to R2.');
    return;
  }

  const manifest = { startedAt: new Date(now).toISOString(), keys: [] };
  const manifestFile = join(ROOT, `scripts/seed-manifest-${now}.json`);
  const save = () => writeFileSync(manifestFile, JSON.stringify(manifest, null, 1));
  let done = 0;
  for (const p of plan) {
    await putJson(`symbols/${p.sid}.json`, p.doc);
    await putJson(`history/${p.ex.id}.json`, { exampleId: p.ex.id, symbol: p.sid, versions: [{ body: p.ex.body, editor: SYSTEM, at: now }] });
    manifest.keys.push(`symbols/${p.sid}.json`, `history/${p.ex.id}.json`);
    if (++done % 50 === 0) {
      save();
      console.log(`${done}/${plan.length}`);
    }
  }
  const user = (await getJson('users/0.json')) ?? { id: 0, login: SYSTEM.login, joinedAt: now, lastSeenAt: now, contributions: [] };
  const have = new Set(user.contributions.map((c) => c.id));
  user.contributions.push(...plan.filter((p) => !have.has(p.ex.id)).map((p) => ({ type: 'example', symbol: p.sid, id: p.ex.id, at: now })));
  await putJson('users/0.json', user);
  await putJson('logins/python-docs.json', { id: 0 });
  manifest.keys.push('users/0.json', 'logins/python-docs.json');
  manifest.finishedAt = new Date().toISOString();
  save();
  console.log(`Seeded ${plan.length} examples. Manifest: ${manifestFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
