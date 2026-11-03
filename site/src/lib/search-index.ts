// Build-time search index (PLAN.md §5 #22–23). Two files, both versioned by a
// content hash so they can be cached forever:
//   ac.json   rows for the autocomplete (loaded when a search box gets focus)
//   docs.json signatures + longer docs, loaded only by /search
import { createHash } from 'node:crypto';
import { modules, summary, symbols } from './data';
import { KINDS, POPULAR } from '../scripts/search-core';
import { quickref, HOME_MODULES } from '../content/quickref';
import { docFor, exampleCount } from './community-data';
import type { AcRow } from '../scripts/search-core';

const kindIndex = (k: string) => {
  const i = (KINDS as readonly string[]).indexOf(k);
  if (i < 0) throw new Error(`search index: unknown kind ${k}`);
  return i;
};

// "Commonly used" = in the curated quickref or featured on the home page.
const popular = new Set([
  ...quickref.flatMap((s) => s.categories.flatMap((c) => c.groups.flatMap((g) => g.ids))),
  ...HOME_MODULES.flatMap((m) => [m.module, ...m.highlights.map((h) => `${m.module}/${h}`)]),
]);

// Modules first, then symbols, in data order. docs.json uses the same order.
const rows: AcRow[] = [
  ...modules.map((m): AcRow => [m.name, '', 0, summary(m.synopsis ?? m.doc, 100), popular.has(m.name) ? POPULAR : 0]),
  ...symbols.map((s): AcRow => [s.module, s.qualname, kindIndex(s.kind), summary(s.doc, 100), popular.has(s.id) ? POPULAR : 0, exampleCount(s.id)]),
];

/** docs.json row: [signatures, doc (first 300 chars), see-also symbol ids]. */
type DocRow = [string[], string, string[]];
const docRows: DocRow[] = [
  ...modules.map((m): DocRow => [[], (m.doc ?? m.synopsis ?? '').slice(0, 300), []]),
  ...symbols.map((s): DocRow => [s.signatures, (s.doc ?? '').slice(0, 300), (docFor(s.id)?.seeAlsos ?? []).map((sa) => sa.to)]),
];

export const acJson = JSON.stringify(rows);
export const docsJson = JSON.stringify(docRows);

const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 12);
export const acUrl = `/search-index/ac.json?v=${hash(acJson)}`;
export const docsUrl = `/search-index/docs.json?v=${hash(docsJson)}`;

/** Known symbol ids, one per line, for the Worker's write-path check (PLAN.md §7.4). */
export const symbolsTxt = symbols.map((s) => s.id).join('\n') + '\n';
