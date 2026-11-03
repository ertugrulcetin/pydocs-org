// Layout check (PLAN.md §1, §13 Phase 2): loads the main page types at phone,
// tablet and desktop widths and fails if
//   1. the page scrolls sideways, or
//   2. text or links stick out of a bordered/filled box (a card, code block,
//      list row) that does not scroll or clip them.
// Usage: node e2e/layout-check.mjs [baseUrl]   (default http://localhost:4321)
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:4321';
const WIDTHS = [375, 768, 1280, 1440];
const PAGES = [
  '/',
  '/library',
  '/library/all',
  '/quickref',
  '/search?q=split',
  '/builtins',
  '/builtins/str.split',
  '/os.path',
  '/os.path/join',
  '/collections/Counter',
  '/xml.parsers.expat.errors',
  '/logging/DEBUG',
  '/contribute',
  '/examples-styleguide',
  '/nope-404',
];

function findOverflow() {
  const problems = [];
  const vw = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth > vw) problems.push(`page is ${document.documentElement.scrollWidth}px wide (viewport ${vw}px)`);
  const boxes = [...document.querySelectorAll('body *')].filter((el) => {
    if (el.closest('.mobile-nav-menu, header.navbar')) return false;
    const cs = getComputedStyle(el);
    if (cs.overflowX !== 'visible' || cs.display === 'inline' || cs.display === 'contents') return false;
    const bordered = parseFloat(cs.borderRightWidth) > 0 || parseFloat(cs.borderLeftWidth) > 0;
    const filled = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent';
    return (bordered || filled) && el.getBoundingClientRect().width > 0;
  });
  for (const box of boxes) {
    const right = box.getBoundingClientRect().right;
    for (const child of box.querySelectorAll('a, span, code, dt, dd, li, p, h1, h2, h3, h4, h5, pre')) {
      // Content inside a scrolling or clipping element is fine (e.g. ellipsis, code blocks).
      let clip = child.parentElement;
      let clipped = false;
      while (clip && clip !== box) {
        if (getComputedStyle(clip).overflowX !== 'visible') {
          clipped = true;
          break;
        }
        clip = clip.parentElement;
      }
      if (clipped) continue;
      const r = child.getBoundingClientRect();
      if (r.width > 0 && r.right > right + 1) {
        const label = (child.textContent ?? '').trim().slice(0, 40);
        problems.push(`"${label}" sticks out of .${[...box.classList].join('.') || box.tagName.toLowerCase()} by ${Math.round(r.right - right)}px`);
        break;
      }
    }
  }
  return [...new Set(problems)].slice(0, 5);
}

const browser = await chromium.launch();
let failures = 0;
for (const width of WIDTHS) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  for (const path of PAGES) {
    await page.goto(BASE + path, { waitUntil: 'networkidle' });
    const problems = await page.evaluate(findOverflow);
    if (problems.length) {
      failures++;
      console.log(`FAIL ${width}px ${path}\n  - ${problems.join('\n  - ')}`);
    }
  }
  await page.close();
}
await browser.close();
console.log(failures ? `${failures} page/width combination(s) with layout problems` : `layout OK: ${PAGES.length} pages x ${WIDTHS.length} widths`);
process.exit(failures ? 1 : 0);
