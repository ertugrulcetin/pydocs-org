// Build-time access to the reference data in data/py-3.15 (PLAN.md §6).
// Loaded once per build; pages import the helpers below.
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface Change {
  version: string;
  text: string;
}
export interface Deprecation {
  version: string | null;
  removedIn?: string | null;
  text: string;
}
export type Kind =
  | 'function' | 'method' | 'classmethod' | 'staticmethod' | 'class' | 'exception'
  | 'attribute' | 'data' | 'property' | 'decorator';

export interface PySymbol {
  id: string; // "builtins/str.split"
  module: string;
  qualname: string;
  name: string;
  kind: Kind;
  parent: string | null;
  signatures: string[];
  doc: string | null;
  docsUrl: string;
  added: string | null;
  changed: Change[];
  deprecated: Deprecation | null;
  availability: string[];
  source: { path: string; line: number } | null;
  implDetail: boolean;
  isAsync: boolean;
}
export interface PyModule {
  name: string;
  synopsis: string | null;
  doc: string | null;
  chapter: string;
  docsUrl: string;
  availability: string[];
  deprecated: Deprecation | null;
}
export interface Chapter {
  title: string;
  modules: string[];
}
export interface Meta {
  python: string;
  docsTag: string;
  generatedAt: string;
  docsBaseUrl: string;
  sourceBaseUrl: string;
}

const DATA_DIR = resolve(process.cwd(), '../data/py-3.15');
const readJson = <T>(...parts: string[]): T => JSON.parse(readFileSync(join(DATA_DIR, ...parts), 'utf8')) as T;

/** Top-level URL segments the site uses itself; no module may take them (PLAN.md §4). */
const RESERVED = new Set(['library', 'quickref', 'search', 'search-index', 'manifest', 'ex', 'u', 'api', 'auth', 'concepts', 'shell', 'css', 'fonts', 'img', 'contribute', 'examples-styleguide', 'export.json']);

export const meta: Meta = readJson<Meta>('meta.json');
export const chapters: Chapter[] = readJson<Chapter[]>('chapters.json');
export const modules: PyModule[] = readJson<PyModule[]>('modules.json').sort((a, b) => a.name.localeCompare(b.name));
export const symbols: PySymbol[] = readdirSync(join(DATA_DIR, 'symbols'))
  .filter((f) => f.endsWith('.json'))
  .sort()
  .flatMap((f) => readJson<PySymbol[]>('symbols', f));

for (const m of modules) {
  if (RESERVED.has(m.name.split('.')[0]!) || m.name.startsWith('_idx')) {
    throw new Error(`module "${m.name}" clashes with a reserved site path (PLAN.md §4)`);
  }
}

export const moduleByName = new Map(modules.map((m) => [m.name, m]));
export const symbolById = new Map(symbols.map((s) => [s.id, s]));

const groupBy = <T, K>(xs: T[], key: (x: T) => K): Map<K, T[]> => {
  const out = new Map<K, T[]>();
  for (const x of xs) {
    const k = key(x);
    const list = out.get(k);
    if (list) list.push(x);
    else out.set(k, [x]);
  }
  return out;
};

const byName = (a: PySymbol, b: PySymbol) => a.qualname.localeCompare(b.qualname, 'en', { sensitivity: 'base' }) || a.qualname.localeCompare(b.qualname);

/** Symbols listed on a module page: those with no parent in the data (methods live on their class page). */
export const topLevelByModule = groupBy(
  symbols.filter((s) => s.parent === null || !symbolById.has(s.parent)).sort(byName),
  (s) => s.module,
);
/** Members of a class/exception, for its own page. */
export const membersByParent = groupBy(
  symbols.filter((s) => s.parent !== null && symbolById.has(s.parent)).sort(byName),
  (s) => s.parent!,
);

export const symbolUrl = (s: Pick<PySymbol, 'module' | 'qualname'>): string => `/${s.module}/${s.qualname}`;
export const moduleUrl = (name: string): string => `/${name}`;

/** Display name, e.g. "len" for builtins, "os.path.join" otherwise. */
export const fullName = (s: Pick<PySymbol, 'module' | 'qualname'>): string =>
  s.module === 'builtins' ? s.qualname : `${s.module}.${s.qualname}`;

/** First sentence (or line) of a docstring, for listings and meta descriptions. */
const SIGNATURE_LINE = /^[\w.]+\(.*\)\s*(->.*)?$/;

export const summary = (doc: string | null | undefined, max = 200): string => {
  if (!doc) return '';
  // Docstrings of C types often start with signature lines ("str(object='') -> str"); skip them.
  const lines = doc.trim().split('\n');
  while (lines.length > 1 && SIGNATURE_LINE.test(lines[0]!.trim())) lines.shift();
  const para = lines.join('\n').trim().split(/\n\s*\n/)[0]!.replace(/\s+/g, ' ');
  const m = para.match(/^.*?[.!?](?=\s|$)/);
  const s = m ? m[0] : para;
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

/** Group names by first character for ClojureDocs-style letter sections ("_" for dunders). */
export const byFirstLetter = <T>(xs: T[], name: (x: T) => string): [string, T[]][] =>
  [...groupBy(xs, (x) => name(x)[0]!.toLowerCase())].sort(([a], [b]) => a.localeCompare(b));

// ---- library nav tree (ClojureDocs' ns-tree) ----

export interface TreeNode {
  segment: string;
  fullName: string;
  isModule: boolean;
  children: TreeNode[];
}

/** Builds a dotted-name tree, e.g. ["xml.dom", "xml.etree.ElementTree"] -> xml > dom, etree > ElementTree. */
export const moduleTree = (names: string[]): TreeNode[] => {
  const root: TreeNode = { segment: '', fullName: '', isModule: false, children: [] };
  for (const name of [...names].sort()) {
    let node = root;
    const parts = name.split('.');
    parts.forEach((seg, i) => {
      const full = parts.slice(0, i + 1).join('.');
      let child = node.children.find((c) => c.segment === seg);
      if (!child) {
        child = { segment: seg, fullName: full, isModule: false, children: [] };
        node.children.push(child);
      }
      if (i === parts.length - 1) child.isModule = true;
      node = child;
    });
  }
  return root.children;
};

export const chapterOf = (moduleName: string): Chapter | undefined =>
  chapters.find((c) => c.modules.includes(moduleName));
