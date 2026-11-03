// Lazy loader for the autocomplete index (no side effects on import).
import { prepare } from './search-core';
import type { AcRow, Prepared } from './search-core';

let index: Promise<Prepared> | undefined;

export const loadIndex = (): Promise<Prepared> =>
  (index ??= fetch(document.querySelector<HTMLMetaElement>('meta[name="pydocs:search-ac"]')?.content ?? '/search-index/ac.json')
    .then((r) => r.json() as Promise<AcRow[]>)
    .then(prepare));
