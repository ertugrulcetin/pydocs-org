// Client-side search ranking, shared by the autocomplete and /search.
// Port of ClojureDocs' behavior (search.clj: prefix match, then sort by edit
// distance to the name), run in the browser over a static index (PLAN.md §3).

/** Index row: [module, qualname ("" for a module entry), kind index, summary, flags]. */
export type AcRow = [string, string, number, string, number?];
/** flags bit: symbol is in the curated quickref, i.e. commonly used. */
export const POPULAR = 1;

export const KINDS = [
  'module', 'function', 'method', 'classmethod', 'staticmethod', 'class',
  'exception', 'attribute', 'data', 'property', 'decorator',
] as const;

export interface Entry {
  i: number;
  module: string;
  qualname: string;
  kind: string;
  summary: string;
  /** "os.path.join", "len" (builtins), or the module name. */
  fullName: string;
  href: string;
  popular: boolean;
}

export interface Prepared {
  entries: Entry[];
  caseNames: string[][]; // name, qualname, full name in original case
  full: string[]; // lowercased full names
  qual: string[]; // lowercased qualnames (module name for modules)
  name: string[]; // lowercased last segment
  tokens: string[][]; // lowercased parts split on "." and "_"
}

export function prepare(rows: AcRow[]): Prepared {
  const entries = rows.map(([module, qualname, k, summary, flags = 0], i): Entry => {
    const isModule = qualname === '';
    const fullName = isModule ? module : module === 'builtins' ? qualname : `${module}.${qualname}`;
    return {
      i,
      module,
      qualname,
      kind: KINDS[k] ?? 'symbol',
      summary,
      fullName,
      href: isModule ? `/${module}` : `/${module}/${qualname}`,
      popular: (flags & POPULAR) !== 0,
    };
  });
  const full = entries.map((e) => e.fullName.toLowerCase());
  const qual = entries.map((e) => (e.qualname || e.module).toLowerCase());
  const name = qual.map((q) => q.slice(q.lastIndexOf('.') + 1));
  const tokens = full.map((f) => f.split(/[._]+/).filter(Boolean));
  const caseNames = entries.map((e) => {
    const qn = e.qualname || e.module;
    return [qn.slice(qn.lastIndexOf('.') + 1), qn, e.fullName];
  });
  return { entries, caseNames, full, qual, name, tokens };
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/**
 * Ranks entries for query `q`:
 * tier 0 exact name, 1 prefix of name/qualname/full name, 2 prefix of a
 * dotted/underscored part, 3 substring of the full name. Within a tier: exact
 * case first ("Path" -> pathlib.Path), then commonly used (quickref) symbols,
 * then edit distance to the name (ClojureDocs), then modules and builtins,
 * then shorter names.
 */
export function search(p: Prepared, query: string, limit = 12): Entry[] {
  let raw = query.trim();
  if (raw.toLowerCase().startsWith('builtins.')) raw = raw.slice('builtins.'.length);
  const q = raw.toLowerCase();
  if (!q) return [];
  const hits: { i: number; tier: number; exactCase: number; pop: number; dist: number; boost: number }[] = [];
  for (let i = 0; i < p.entries.length; i++) {
    const name = p.name[i]!;
    const qual = p.qual[i]!;
    const full = p.full[i]!;
    let tier: number;
    if (name === q || qual === q || full === q) tier = 0;
    else if (name.startsWith(q) || qual.startsWith(q) || full.startsWith(q)) tier = 1;
    else if (p.tokens[i]!.some((t) => t.startsWith(q))) tier = 2;
    else if (full.includes(q)) tier = 3;
    else continue;
    const e = p.entries[i]!;
    const boost = e.kind === 'module' ? 0 : e.module === 'builtins' ? 1 : 2;
    const exactCase = p.caseNames[i]!.some((n) => n === raw || n.startsWith(raw)) ? 0 : 1;
    hits.push({ i, tier, exactCase, pop: e.popular ? 0 : 1, dist: levenshtein(name, q), boost });
  }
  hits.sort((a, b) => a.tier - b.tier || a.exactCase - b.exactCase || a.pop - b.pop || a.dist - b.dist || a.boost - b.boost || p.full[a.i]!.length - p.full[b.i]!.length || (p.full[a.i]! < p.full[b.i]! ? -1 : 1));
  return hits.slice(0, limit).map((h) => p.entries[h.i]!);
}

/** ClojureDocs' ellipsis: cut to n chars including "...". */
export const ellipsis = (n: number, s: string): string => (s.length - 3 > n ? `${s.slice(0, n - 3)}...` : s);
