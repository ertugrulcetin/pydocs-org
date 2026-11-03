// "Recent" pages on symbol pages (PLAN.md §5 #19; ClojureDocs keeps them in the
// session, we use localStorage). Shows up to 8 other symbols you viewed.
const KEY = 'pd:recent';
const el = document.getElementById('recent-pages');
const sid = el?.dataset.sid;

if (el && sid) {
  let recent: string[] = [];
  try {
    recent = (JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown[]).filter((x): x is string => typeof x === 'string');
  } catch {
    recent = [];
  }
  const others = recent.filter((s) => s !== sid).slice(0, 8);
  if (others.length) {
    const h3 = Object.assign(document.createElement('h3'), { textContent: 'Recent' });
    const ul = document.createElement('ul');
    for (const s of others) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = `/${s}`;
      a.textContent = s.startsWith('builtins/') ? s.slice('builtins/'.length) : s.replace('/', '.');
      li.appendChild(a);
      ul.appendChild(li);
    }
    el.textContent = '';
    el.appendChild(h3);
    el.appendChild(ul);
    el.hidden = false;
  }
  try {
    localStorage.setItem(KEY, JSON.stringify([sid, ...recent.filter((s) => s !== sid)].slice(0, 10)));
  } catch {
    // storage unavailable (private mode): no recent list
  }
}
