// Autocomplete for every `form.search` on the page (navbar and home), with
// ClojureDocs' keys: ctrl-s focuses, ↑/↓ and ctrl-n/ctrl-p move, Esc cancels,
// Enter opens the highlighted result (or /search when nothing matches).
// Markup matches ClojureDocs' mods/search.cljs so the reused CSS applies.
import { ellipsis, search } from './search-core';
import type { Entry } from './search-core';
import { loadIndex } from './search-index-client';

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const entryHtml = (e: Entry, i: number, highlighted: boolean): string => {
  const type = e.kind === 'module' ? 'module' : `${e.kind} / 0 ex`;
  const label = e.kind === 'module' ? e.module : `${e.qualname} (${e.module})`;
  return (
    `<li id="ac-${i}"${highlighted ? ' class="highlighted"' : ''} data-href="${esc(e.href)}">` +
    `<div class="ac-entry"><span class="ac-type">${esc(type)}</span>` +
    `<h4><a href="${esc(e.href)}">${esc(label)}</a></h4>` +
    `<p>${esc(ellipsis(100, e.summary))}</p></div></li>`
  );
};

function wire(form: HTMLFormElement): void {
  const input = form.querySelector<HTMLInputElement>('input.query');
  if (!input) return;
  // Navbar: results go in the header's .ac-results-widget; home: the sibling ul.ac-results.
  const host =
    form.closest('header.navbar')?.querySelector<HTMLElement>('.ac-results-widget') ??
    form.parentElement?.querySelector<HTMLElement>('ul.ac-results') ??
    null;
  if (!host) return;
  const list = host.matches('ul.ac-results') ? host : host.appendChild(Object.assign(document.createElement('ul'), { className: 'ac-results' }));

  let results: Entry[] = [];
  let highlighted = 0;
  let timer: number | undefined;

  const render = (text: string) => {
    document.body.classList.toggle('search-active', text.length > 0);
    if (!text) {
      list.innerHTML = '';
      return;
    }
    list.innerHTML = results.length
      ? results.map((e, i) => entryHtml(e, i, i === highlighted)).join('')
      : '<li class="null-state">Nothing Found</li>';
  };

  const run = async () => {
    const text = input.value;
    const p = await loadIndex();
    if (text !== input.value) return; // a newer keystroke is pending
    results = search(p, text);
    highlighted = 0;
    render(text.trim());
  };

  const move = (delta: number) => {
    if (!results.length) return;
    highlighted = (highlighted + delta + results.length) % results.length;
    render(input.value.trim());
    list.querySelector(`#ac-${highlighted}`)?.scrollIntoView({ block: 'nearest' });
  };

  input.addEventListener('focus', () => void loadIndex(), { once: true });
  input.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(run, 80);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      input.value = '';
      results = [];
      render('');
      input.blur();
      e.preventDefault();
    } else if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) {
      move(1);
      e.preventDefault();
    } else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) {
      move(-1);
      e.preventDefault();
    }
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const chosen = results[highlighted];
    if (chosen && input.value.trim()) location.href = chosen.href;
    else if (input.value.trim()) location.href = `/search?q=${encodeURIComponent(input.value.trim())}`;
  });
  list.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    // Let ctrl/cmd/middle clicks on the link open a new tab as usual.
    if (target.closest('a') && (e.ctrlKey || e.metaKey || e.button === 1)) return;
    const li = target.closest<HTMLElement>('li[data-href]');
    if (li) {
      e.preventDefault();
      location.href = li.dataset.href!;
    }
  });
}

document.querySelectorAll<HTMLFormElement>('form.search').forEach(wire);

// ctrl-s focuses the visible search box (and stops the browser's save dialog).
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && (e.key === 's' || e.key === 'S')) {
    const input = [...document.querySelectorAll<HTMLInputElement>('.search input.query')].find((el) => el.offsetParent !== null);
    if (input) {
      input.focus();
      e.preventDefault();
    }
  }
});
