// Known symbol ids from the build (/manifest/symbols.txt, a static asset).
// Every write checks its symbol against this list, which blocks R2 key
// injection such as "../" (PLAN.md §7.4 step 2). Cached per isolate.
let cache: Promise<Set<string>> | undefined;

export function knownSymbols(assets: Fetcher): Promise<Set<string>> {
  cache ??= assets
    .fetch('https://assets.local/manifest/symbols.txt')
    .then((r) => {
      if (!r.ok) throw new Error(`manifest: HTTP ${r.status}`);
      return r.text();
    })
    .then((t) => new Set(t.split('\n').filter(Boolean)))
    .catch((err) => {
      cache = undefined; // retry on the next request
      throw err;
    });
  return cache;
}

/** For tests. */
export const resetManifestCache = () => {
  cache = undefined;
};

/** Symbol ids are "{module}/{qualname}" with dotted Python names only. */
export const SYMBOL_ID = /^[A-Za-z_][A-Za-z0-9_.]*\/[A-Za-z_][A-Za-z0-9_.]*$/;
