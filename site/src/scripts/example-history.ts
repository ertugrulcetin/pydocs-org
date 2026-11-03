// /ex/{id}: every version of an example, newest first (ClojureDocs'
// example-handler in pages/vars.clj). Served from /shell/example via _redirects.
import { avatarUrl, fetchData, timeago } from '../lib/community-client';
import type { Author, HistoryDoc } from '../../worker/community.ts';
import { highlightPython } from '../lib/highlight';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const avatar = (a: Author) =>
  `<a href="/u/${esc(a.login)}" title="${esc(a.login)}"><img class="avatar" src="${avatarUrl(a.id)}" alt="${esc(a.login)}"></a>`;

async function main(root: HTMLElement): Promise<void> {
  const id = location.pathname.split('/')[2] ?? '';
  if (!/^ex_[0-9A-HJKMNP-TV-Z]{26}$/.test(id)) {
    root.innerHTML = '<p>No such example.</p>';
    return;
  }
  const h = await fetchData<HistoryDoc>(`history/${id}.json`);
  if (!h) {
    root.innerHTML = '<p>No such example.</p>';
    return;
  }
  const link = `<a href="/${esc(h.symbol)}">${esc(h.symbol)}</a>`;
  document.title = `Example history for ${h.symbol} | PyDocs`;
  if (h.deletedAt) {
    root.innerHTML = `<p>This example for ${link} was deleted ${timeago(h.deletedAt)} ago.</p>`;
    return;
  }
  const versions = [...h.versions].reverse();
  root.innerHTML =
    `<p>Example history for ${link}, in order from newest to oldest. The current version is outlined in yellow.</p>` +
    versions
      .map((v, i) => {
        const verb = i === versions.length - 1 ? 'Created' : 'Edited';
        return (
          `<div class="var-example${i === 0 ? ' highlighted' : ''}"><div><div class="example-meta">` +
          `<div class="contributors">${verb} by&nbsp;${avatar(v.editor)} ${timeago(v.at)} ago.</div><div class="links"></div>` +
          `</div></div><div><div class="example-body"><pre class="syntaxify">${highlightPython(v.body)}</pre></div></div></div>`
        );
      })
      .join('');
}

const root = document.getElementById('example-history');
if (root) main(root).catch(() => (root.innerHTML = '<p>Could not load this example. Please try again.</p>'));
