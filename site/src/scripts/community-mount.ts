// Hydrates the server-rendered Community widgets on symbol pages. A shared,
// cached module instead of Astro's per-page inline island runtime (smaller
// pages, and no inline scripts for the CSP in PLAN.md §11).
import { h, hydrate } from 'preact';
import Community from '../islands/Community';

const el = document.getElementById('community');
if (el?.dataset.sid) {
  const props = { sid: el.dataset.sid, initial: JSON.parse(el.dataset.initial ?? 'null'), seeAlsoDocs: JSON.parse(el.dataset.seeAlsoDocs ?? '{}') };
  const run = () => hydrate(h(Community, props), el);
  if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 2000 });
  else setTimeout(run, 50);
}
