// /u/{login}: a contributor's profile (ClojureDocs' pages/user.clj), plus note
// and see-also counts (PLAN.md §5 #21). Served from /shell/user via _redirects.
import { avatarUrl, fetchData } from '../lib/community-client';
import type { UserDoc } from '../../shared/types.ts';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const ANCHOR = { example: (id: string) => `#example-${id}`, seeAlso: () => '#see-also', note: () => '#notes' } as const;
const LABEL = { example: 'example', seeAlso: 'see also', note: 'note' } as const;

async function main(root: HTMLElement): Promise<void> {
  const login = decodeURIComponent(location.pathname.split('/')[2] ?? '');
  const notFound = () => (root.innerHTML = `<div class="col-sm-10 col-sm-offset-1"><h1>${esc(login)}</h1><p>No PyDocs user called <b>${esc(login)}</b>.</p></div>`);
  if (!/^[A-Za-z0-9-]{1,39}$/.test(login)) return void notFound();
  const ref = await fetchData<{ id: number }>(`logins/${login.toLowerCase()}.json`);
  const user = ref && (await fetchData<UserDoc>(`users/${ref.id}.json`));
  if (!user) return void notFound();

  document.title = `${user.login} | PyDocs`;
  const c = user.contributions;
  const n = (t: string) => c.filter((x) => x.type === t).length;
  const items = [...c]
    .sort((a, b) => a.symbol.localeCompare(b.symbol) || a.at - b.at)
    .map((x) => `<li><a href="/${esc(x.symbol)}${ANCHOR[x.type](x.id)}">${esc(x.symbol)}</a> <small class="text-muted">${LABEL[x.type]}</small></li>`)
    .join('');
  root.innerHTML =
    `<div class="col-sm-10 col-sm-offset-1"><div class="row">` +
    `<div class="col-sm-4"><span class="user-avatar"><a class="avatar-link" href="https://github.com/${esc(user.login)}">` +
    `<img class="avatar" src="${avatarUrl(user.id, 200)}" alt="${esc(user.login)}"></a></span></div>` +
    `<div class="col-sm-8"><h1>${esc(user.login)}</h1>` +
    `<p>User <b>${esc(user.login)}</b> has authored ${plural(n('example'), 'example', 'examples')}, ` +
    `${plural(n('seeAlso'), 'see also', 'see alsos')}, and ${plural(n('note'), 'note', 'notes')}.</p>` +
    `<ul>${items}</ul></div></div></div>`;
}

const root = document.getElementById('user-page');
if (root) main(root).catch(() => (root.innerHTML = '<p>Could not load this user. Please try again.</p>'));
