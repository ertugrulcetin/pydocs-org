// Downloads the public community content (pydocs-content) into site/.bake/
// for the build to bake into static pages (PLAN.md Phase 5).
//
//   Listing: Cloudflare REST API (R2 has no public listing). Needs
//            CLOUDFLARE_API_TOKEN (R2 read) and CLOUDFLARE_ACCOUNT_ID.
//   Content: https://data.pydocs.org (public, cached, no API rate limit).
//
// Without a token (e.g. a quick local build) it writes an empty snapshot and
// the site builds with no baked community content.
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '.bake');
const BUCKET = 'pydocs-content';
const DATA = process.env.PYDOCS_DATA_URL ?? 'https://data.pydocs.org';
const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account } = process.env;
const PREFIXES = ['symbols/', 'activity/'];
const CONCURRENCY = 16;

async function listKeys(prefix) {
  const keys = [];
  let cursor;
  do {
    const url = new URL(`https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets/${BUCKET}/objects`);
    url.searchParams.set('prefix', prefix);
    url.searchParams.set('per_page', '1000');
    if (cursor) url.searchParams.set('cursor', cursor);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const body = await res.json();
    if (!res.ok || !body.success) throw new Error(`R2 list ${prefix}: HTTP ${res.status} ${JSON.stringify(body.errors)}`);
    keys.push(...body.result.map((o) => o.key));
    cursor = body.result_info?.is_truncated === false ? undefined : body.result_info?.cursor;
    if (!body.result.length) cursor = undefined;
  } while (cursor);
  return keys;
}

async function fetchAll(keys) {
  const docs = {};
  let i = 0;
  async function worker() {
    while (i < keys.length) {
      const key = keys[i++];
      // A cache-busting query: the bake should see writes from the last minute too.
      const res = await fetch(`${DATA}/${key}?bake=${Date.now()}`);
      if (res.status === 404) continue; // deleted between list and fetch
      if (!res.ok) throw new Error(`fetch ${key}: HTTP ${res.status}`);
      docs[key] = await res.json();
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return docs;
}

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  if (!token || !account) {
    console.log('snapshot: no CLOUDFLARE_API_TOKEN/CLOUDFLARE_ACCOUNT_ID, writing an empty snapshot');
    await writeFile(join(OUT, 'snapshot.json'), JSON.stringify({ takenAt: Date.now(), symbols: {}, activity: [] }));
    return;
  }
  const keys = (await Promise.all(PREFIXES.map(listKeys))).flat();
  const docs = await fetchAll(keys);
  const symbols = {};
  for (const [key, doc] of Object.entries(docs)) {
    if (key.startsWith('symbols/')) symbols[doc.symbol] = doc;
  }
  const activity = docs['activity/recent.json']?.events ?? [];
  await writeFile(join(OUT, 'snapshot.json'), JSON.stringify({ takenAt: Date.now(), symbols, activity }));
  const examples = Object.values(symbols).reduce((n, d) => n + d.examples.length, 0);
  console.log(`snapshot: ${Object.keys(symbols).length} symbols with content, ${examples} examples, ${activity.length} activity events`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
