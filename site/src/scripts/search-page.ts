// /search?q=…&page=… results, rendered in the browser from the static index
// (ClojureDocs' search-page-handler: 10 per page, prev/next, arglists, doc cut
// at 300 chars, example count).
import { loadIndex } from './search-index-client';
import { search } from './search-core';

const PER_PAGE = 10;
const root = document.getElementById('search-results');
const docsUrl = document.querySelector<HTMLMetaElement>('meta[name="pydocs:search-docs"]')?.content ?? '/search-index/docs.json';

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

async function main(el: HTMLElement): Promise<void> {
  const params = new URLSearchParams(location.search);
  const q = (params.get('q') ?? '').trim();
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1);
  if (!q) {
    el.innerHTML = '<div class="search-results-header"><h1>Search</h1><p>Type a name in the search box above.</p></div>';
    return;
  }
  document.title = `Search results for ${q} | PyDocs`;
  document.querySelectorAll<HTMLInputElement>('.search input.query').forEach((i) => (i.value = q));

  const [prepared, docs] = await Promise.all([
    loadIndex(),
    fetch(docsUrl).then((r) => r.json() as Promise<[string[], string, string[]?][]>),
  ]);
  const all = search(prepared, q, 1000);
  const start = (page - 1) * PER_PAGE;
  const shown = all.slice(start, start + PER_PAGE);
  const link = (p: number, label: string) => `<a href="/search?q=${encodeURIComponent(q)}&amp;page=${p}">${label}</a>`;
  const prev = page > 1 ? link(page - 1, 'prev page') : 'prev page';
  const next = start + PER_PAGE < all.length ? link(page + 1, 'next page') : 'next page';
  const range = all.length ? `${start + 1} to ${Math.min(start + PER_PAGE, all.length)} of ${all.length} results.` : 'No results.';

  el.innerHTML =
    `<div class="search-results-header"><h1>Search results for query: <b>${esc(q)}</b></h1>` +
    `<p>${range} <span class="search-controls pull-right">${prev} | ${next}</span></p></div>` +
    `<ul class="search-results">${shown
      .map((e) => {
        const [sigs, doc, seeAlsos = []] = docs[e.i] ?? [[], '', []];
        const name = e.kind === 'module' ? e.module : e.qualname;
        const sub = e.kind === 'module' ? 'module' : e.module;
        return (
          `<li class="search-result"><h2><a href="${esc(e.href)}">${esc(name)}</a></h2><h3>${esc(sub)}</h3>` +
          (sigs.length ? `<ul class="arglists">${sigs.map((s) => `<li class="arglist">${esc(s)}</li>`).join('')}</ul>` : '') +
          `<p>${esc(doc.length >= 300 ? `${doc}...` : doc)}</p>` +
          (e.kind === 'module'
            ? ''
            : `<div class="meta-info">${e.examples} example${e.examples === 1 ? '' : 's'}` +
              (seeAlsos.length
                ? `<span class="see-alsos"> &middot; See also: ${seeAlsos
                    .map((sid) => {
                      const i = sid.indexOf('/');
                      return `<span class="see-also"><a href="/${esc(sid)}"><span class="ns">${esc(sid.slice(0, i))}/</span>${esc(sid.slice(i + 1))}</a></span>`;
                    })
                    .join(', ')}</span>`
                : '') +
              '</div>') +
          '</li>'
        );
      })
      .join('')}</ul>`;
}

if (root) void main(root);
