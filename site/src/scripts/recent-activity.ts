// Home "Recently Updated" (ClojureDocs' intro page): the 3 latest events from
// activity/recent.json. Phase 5 bakes them into the HTML; this keeps them live.
import { avatarUrl, fetchData, timeago } from '../lib/community-client';
import type { ActivityEvent } from '../../shared/types.ts';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const WHAT = { example: 'an example', seeAlso: 'a see also', note: 'a note' } as const;
const VERB = { create: 'authored', edit: 'edited', delete: 'deleted' } as const;

async function main(root: HTMLElement): Promise<void> {
  const a = await fetchData<{ events: ActivityEvent[] }>('activity/recent.json');
  const events = (a?.events ?? []).slice(0, 3);
  if (!events.length) return;
  root.innerHTML = events
    .map(
      (e) =>
        `<div class="recently-updated"><a class="avatar-link" href="/u/${esc(e.user.login)}"><img class="avatar" src="${avatarUrl(e.user.id, 48)}" alt=""></a>` +
        `<span class="content">${esc(e.user.login)} ${VERB[e.action]} ${WHAT[e.type]} for <a href="/${esc(e.symbol)}">${esc(e.symbol)}</a> ` +
        `${timeago(e.at)} ago.<div class="clear"></div></span></div>`,
    )
    .join('');
}

const root = document.getElementById('recently-updated');
if (root) main(root).catch(() => {});
