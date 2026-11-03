// /admin (PLAN.md Phase 6): recent activity with delete, bans, audit log.
// The Worker enforces admin rights; this page only shows the tools.
import { fetchData, loginUrl, timeago } from '../lib/community-client';
import type { ActivityEvent } from '../../shared/types.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const COLLECTION = { example: 'examples', seeAlso: 'see-alsos', note: 'notes' } as const;

async function call(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message ?? data.error ?? `HTTP ${res.status}`), { status: res.status });
  return data;
}

async function renderActivity(): Promise<void> {
  const el = $('admin-activity');
  const a = await fetchData<{ events: ActivityEvent[] }>('activity/recent.json');
  const events = a?.events ?? [];
  if (!events.length) {
    el.innerHTML = '<p class="null-state">No activity yet.</p>';
    return;
  }
  el.innerHTML =
    '<table class="table table-condensed"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Symbol</th><th></th></tr></thead><tbody>' +
    events
      .map(
        (e) =>
          `<tr><td>${timeago(e.at)} ago</td><td><a href="/u/${esc(e.user.login)}">${esc(e.user.login)}</a></td><td>${esc(e.action)} ${esc(e.type)}</td>` +
          `<td><a href="/${esc(e.symbol)}${e.type === 'example' ? `#example-${esc(e.id)}` : ''}">${esc(e.symbol)}</a></td>` +
          `<td><button class="btn btn-danger btn-xs" data-delete="${esc(e.symbol)}|${COLLECTION[e.type]}|${esc(e.id)}">delete</button></td></tr>`,
      )
      .join('') +
    '</tbody></table>';
}

async function renderBans(): Promise<void> {
  const el = $('admin-bans');
  const bans = (await call('GET', '/api/admin/bans')) as { id: number; login: string; reason: string; by: { login: string }; at: number }[];
  el.innerHTML = bans.length
    ? '<table class="table table-condensed"><thead><tr><th>User</th><th>Reason</th><th>By</th><th>When</th><th></th></tr></thead><tbody>' +
      bans
        .map(
          (b) =>
            `<tr><td><a href="/u/${esc(b.login)}">${esc(b.login)}</a></td><td>${esc(b.reason)}</td><td>${esc(b.by.login)}</td><td>${timeago(b.at)} ago</td>` +
            `<td><button class="btn btn-default btn-xs" data-unban="${esc(b.login)}">unban</button></td></tr>`,
        )
        .join('') +
      '</tbody></table>'
    : '<p class="null-state">Nobody is banned.</p>';
}

let auditCursor: string | null = null;
async function renderAudit(append = false): Promise<void> {
  const el = $('admin-audit');
  const day = ($('audit-day') as HTMLInputElement).value;
  const q = new URLSearchParams({ day });
  if (append && auditCursor) q.set('cursor', auditCursor);
  const page = (await call('GET', `/api/admin/audit?${q}`)) as { records: any[]; cursor: string | null };
  auditCursor = page.cursor;
  const rows = page.records
    .map((r) => {
      const what = r.type === 'user' ? `${esc(r.action)} ${esc(r.target?.login)}` : `${esc(r.action)} ${esc(r.type)} <a href="/${esc(r.symbol)}">${esc(r.symbol)}</a>`;
      const before = r.before?.body ?? r.before?.to ?? '';
      return `<tr><td>${new Date(r.at).toISOString().slice(11, 19)}</td><td>${esc(r.user?.login)}</td><td>${what}</td><td><code>${esc(String(before).slice(0, 80))}</code></td></tr>`;
    })
    .join('');
  const table = el.querySelector('tbody');
  if (append && table) table.insertAdjacentHTML('beforeend', rows);
  else el.innerHTML = rows ? `<table class="table table-condensed"><thead><tr><th>UTC</th><th>Who</th><th>What</th><th>Deleted or old text</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="null-state">No changes that day.</p>';
  $('audit-more').hidden = !auditCursor;
}

const flash = (msg: string, ok = true) => {
  const el = $('admin-flash');
  el.className = `alert ${ok ? 'alert-success' : 'alert-danger'}`;
  el.textContent = msg;
  el.hidden = false;
};

async function main(): Promise<void> {
  const gate = $('admin-gate');
  try {
    await call('GET', '/api/admin/me');
  } catch (e) {
    const status = (e as { status?: number }).status;
    gate.innerHTML = status === 401 ? `<p><a href="${loginUrl()}">Log in</a> with an admin account.</p>` : '<p>Admins only.</p>';
    return;
  }
  gate.hidden = true;
  $('admin-tools').hidden = false;
  ($('audit-day') as HTMLInputElement).value = new Date().toISOString().slice(0, 10);
  await Promise.all([renderActivity(), renderBans(), renderAudit()]);

  document.addEventListener('click', async (ev) => {
    const btn = (ev.target as HTMLElement).closest('button');
    if (!btn) return;
    try {
      if (btn.dataset.delete) {
        const [sid, collection, id] = btn.dataset.delete.split('|');
        if (!confirm(`Delete this ${collection!.replace(/s$/, '')} on ${sid}?`)) return;
        await call('DELETE', `/api/s/${sid}/${collection}/${id}`);
        btn.closest('tr')?.remove();
        flash(`Deleted from ${sid}.`);
      } else if (btn.dataset.unban) {
        await call('POST', '/api/admin/unban', { login: btn.dataset.unban });
        flash(`Unbanned ${btn.dataset.unban}.`);
        await renderBans();
      } else if (btn.id === 'audit-more') {
        await renderAudit(true);
      }
    } catch (e) {
      flash((e as Error).message, false);
    }
  });
  $('ban-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const login = ($('ban-login') as HTMLInputElement).value;
    try {
      await call('POST', '/api/admin/ban', { login, reason: ($('ban-reason') as HTMLInputElement).value });
      flash(`Banned ${login}. They can still read, but can't change anything.`);
      ($('ban-form') as HTMLFormElement).reset();
      await renderBans();
    } catch (e) {
      flash((e as Error).message, false);
    }
  });
  $('audit-day').addEventListener('change', () => void renderAudit());
}

void main();
