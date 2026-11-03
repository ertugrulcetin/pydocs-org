// Resolves the curated quickref (src/content/quickref.ts) against the data and
// fails the build on any unknown symbol id.
import { quickref, HOME_CATEGORIES, HOME_MODULES } from '../content/quickref';
import type { QCategory } from '../content/quickref';
import type { PySymbol } from './data';
import { moduleByName, symbolById } from './data';

const resolve = (id: string): PySymbol => {
  const s = symbolById.get(id);
  if (!s) throw new Error(`quickref: unknown symbol id "${id}" (src/content/quickref.ts)`);
  return s;
};

export interface ResolvedGroup {
  title: string;
  symbols: PySymbol[];
}
export interface ResolvedCategory extends Omit<QCategory, 'groups'> {
  sphere: string;
  groups: ResolvedGroup[];
  count: number;
}

export const spheres = quickref.map((sphere) => ({
  ...sphere,
  categories: sphere.categories.map(
    (c): ResolvedCategory => {
      const groups = c.groups.map((g) => ({ title: g.title, symbols: g.ids.map(resolve) }));
      return { ...c, sphere: sphere.title, groups, count: groups.reduce((n, g) => n + g.symbols.length, 0) };
    },
  ),
}));

const bySlug = new Map(spheres.flatMap((s) => s.categories).map((c) => [c.slug, c]));
export const homeCategories: ResolvedCategory[] = HOME_CATEGORIES.map((slug) => {
  const c = bySlug.get(slug);
  if (!c) throw new Error(`quickref: unknown home category "${slug}"`);
  return c;
});

export const homeModules = HOME_MODULES.map(({ module, highlights }) => {
  const mod = moduleByName.get(module);
  if (!mod) throw new Error(`quickref: unknown home module "${module}"`);
  return { module: mod, highlights: highlights.map((q) => resolve(`${module}/${q}`)) };
});
