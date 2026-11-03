// Browser test of the Examples / See Also / Notes widgets against a fake /api
// (same rules as the Worker). Usage: node e2e/community.mjs [baseUrl]
import { chromium } from 'playwright';

const B = process.argv[2] ?? 'http://localhost:4321';
const SID = 'builtins/str.split';
const shots = process.env.SHOTS; // optional screenshot folder
const ALICE = { id: 100, login: 'alice' };
const BOB = { id: 200, login: 'bob' };
let doc = {
  symbol: SID,
  updatedAt: Date.now(), // live data is newer than the baked copy, as in production
  seeAlsos: [],
  notes: [],
  examples: [
    { id: 'ex_01JBX0000000000000000000AA', body: "'a,b,c'.split(',')\n# => ['a', 'b', 'c']", author: ALICE, editors: [], createdAt: 1, updatedAt: 1, source: null },
  ],
};
let n = 0;
const newId = (p) => `${p}_01JBX${String(++n).padStart(21, '0')}`;
const results = [];
const check = (label, ok, extra = '') => {
  results.push(Boolean(ok));
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${extra}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const errors = [];
await ctx.route('**/api/s/**', async (route) => {
  const req = route.request();
  const parts = new URL(req.url()).pathname.split('/').slice(5); // [collection, id]
  const body = req.postData() ? JSON.parse(req.postData()) : null;
  const now = Date.now();
  const reply = (status, json) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json) });
  if (req.method() === 'GET') return reply(200, doc);
  if (req.headers()['origin'] !== B) return reply(403, { message: 'Bad origin.' });
  const [col, iid] = parts;
  const m = req.method();
  if (col === 'examples') {
    if (m === 'POST') {
      if (!body.body.trim()) return reply(422, { message: 'Whoops, looks like your example is blank.' });
      doc.examples.push({ id: newId('ex'), body: body.body, author: BOB, editors: [], createdAt: now, updatedAt: now, source: null });
    }
    if (m === 'PATCH') {
      const e = doc.examples.find((x) => x.id === iid);
      e.body = body.body;
      e.updatedAt = now;
    }
    if (m === 'DELETE') doc.examples = doc.examples.filter((x) => x.id !== iid);
  } else if (col === 'see-alsos') {
    if (m === 'POST') doc.seeAlsos.push({ id: newId('sa'), to: body.to, author: BOB, createdAt: now });
    if (m === 'DELETE') doc.seeAlsos = doc.seeAlsos.filter((x) => x.id !== iid);
  } else if (col === 'notes') {
    if (m === 'POST') doc.notes.push({ id: newId('nt'), body: body.body, author: BOB, createdAt: now - 3 * 86400e3, updatedAt: now - 3 * 86400e3 });
  }
  doc = { ...doc, updatedAt: now };
  return reply(200, doc);
});

const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
// The intentional 422 in step 3 is logged by the browser as a failed resource; that is expected.
// The XSS step feeds DOMPurify an onerror payload on purpose: Chromium reports the
// blocked inline handler while DOMPurify parses it in an inert document. Nothing runs
// (checked: window.pwned stays unset even with no CSP), so that report is expected.
page.on('console', (msg) => msg.type() === 'error' && !msg.text().includes('status of 422') && !msg.text().includes('inline event handler') && errors.push(msg.text()));

// 1. logged out: live doc renders, counts update, login prompt links to /auth/login
await page.goto(`${B}/${SID}`);
await page.waitForSelector('.var-example .syntaxify');
check('live example rendered with highlighting', (await page.innerHTML('.var-example .syntaxify')).includes('tok-string'));
check('heading count', (await page.textContent('.var-examples h5')) === '1 Example');
check('sidenav count updated', (await page.textContent('.desktop-side-nav [data-count="examples"]')) === '1');
// The page ships with baked examples, so wait for hydration to set the return URL.
await page.waitForFunction(() => document.querySelector('.var-examples .login-required-message a')?.getAttribute('href')?.includes('return='));
check('login prompt', (await page.getAttribute('.var-examples .login-required-message a', 'href'))?.startsWith('/auth/login?return=%2Fbuiltins%2Fstr.split'));
const loggedOutLinks = (await page.$$eval('.var-example .links a', (as) => as.map((a) => a.textContent))).join(' / ');
check('logged out: link / history / run / report, no edit or delete', loggedOutLinks === 'link / history / run / report', loggedOutLinks);
check('report link prefills a GitHub issue', (await page.getAttribute('.var-example .links a[href*="issues/new"]', 'href'))?.includes('labels=report'));

// 2. log in as bob (UI cookie only; the fake API does not check sessions)
const v = Buffer.from(JSON.stringify(BOB)).toString('base64url');
await ctx.addCookies([{ name: 'pd_user', value: v, url: B }]);
await page.goto('about:blank');
await page.goto(`${B}/${SID}#example-ex_01JBX0000000000000000000AA`);
await page.waitForSelector('.add-example .toggle-link');
check('hash highlights example', (await page.getAttribute('.var-example', 'class'))?.includes('highlighted'));
const links = await page.textContent('.var-example .links');
check("alice's example: bob can edit, not delete", links.includes('edit') && !links.includes('delete'), links);

// 3. add example: blank error, tab inserts spaces, preview, ctrl+enter submits
await page.click('.add-example .toggle-link');
await page.click('.add-example button.btn-success');
await page.waitForSelector('.add-example .error-message');
check('blank example error (ClojureDocs copy)', (await page.textContent('.add-example .error-message')).includes('Whoops, looks like your example is blank.'));
await page.click('.add-example textarea');
await page.keyboard.type('def f(x):');
await page.keyboard.press('Enter');
await page.keyboard.press('Tab');
await page.keyboard.type('return x.split()');
const typed = await page.inputValue('.add-example textarea');
check('tab inserts 4 spaces', typed === 'def f(x):\n    return x.split()', JSON.stringify(typed));
await page.click('.add-example .nav-tabs li:nth-child(2) a');
check('preview highlights', (await page.innerHTML('.add-example .live-preview')).includes('tok-def'));
await page.click('.add-example .nav-tabs li:nth-child(1) a');
await page.click('.add-example textarea');
await page.keyboard.press('Control+Enter');
await page.waitForFunction(() => document.querySelector('.var-examples h5')?.textContent === '2 Examples');
check('ctrl+enter adds example; sidenav count 2', (await page.textContent('.desktop-side-nav [data-count="examples"]')) === '2');
if (shots) await page.screenshot({ path: `${shots}/community-examples.png`, clip: { x: 0, y: 300, width: 1280, height: 600 } });

// 4. edit own example, then delete with confirm
const mine = page.locator('.var-example').nth(1);
await mine.locator('.links a', { hasText: /^edit$/ }).click();
await mine.locator('textarea').fill('print("edited")');
await mine.locator('button.btn-success').click();
await page.waitForFunction(() => document.querySelectorAll('.var-example')[1]?.textContent?.includes('edited'));
check('edit example', true);
await mine.locator('.links a', { hasText: /^delete$/ }).click();
await mine.locator('a', { hasText: 'confirm delete?' }).click();
await page.waitForFunction(() => document.querySelector('.var-examples h5')?.textContent === '1 Example');
check('delete with confirm', true);

// 5. see-also via the search index
await page.click('.add-see-also .toggle-link');
await page.fill('.add-see-also input', 're.spl');
await page.waitForSelector('.add-see-also .ac-results li');
const first = await page.textContent('.add-see-also .ac-results li div');
check('see-also autocomplete', first === 're/split', first);
await page.click('.add-see-also .ac-results li button.btn-success');
await page.waitForSelector('.see-also .var-title');
await page.waitForFunction(() => (document.querySelector('.see-also p')?.textContent ?? '').length > 10);
check('see-also added with doc excerpt', true, await page.textContent('.see-also p'));
await page.fill('.add-see-also input', 'str.split');
await page.waitForSelector('.add-see-also .ac-results li button[disabled]');
check('self see-also disabled ("This Symbol")', (await page.textContent('.add-see-also .ac-results li button[disabled]')) === 'This Symbol');

// 6. notes: markdown + code fence, XSS sanitized
await page.click('.add-note .toggle-link');
await page.fill('.add-note textarea', 'Use **sep**.\n\n```\nx.split(",")\n```\n\n<img src=x onerror="window.pwned=1"> [bad](javascript:alert(1))');
await page.click('.add-note button.btn-success');
await page.waitForSelector('.note .note-body pre.syntaxify');
const noteHtml = await page.innerHTML('.note .note-body');
check('note markdown rendered', noteHtml.includes('<strong>sep</strong>'));
check('note XSS sanitized', !(await page.evaluate(() => window.pwned)) && !noteHtml.includes('onerror') && !noteHtml.includes('javascript:'));
check('note meta "3 days ago"', (await page.textContent('.note-meta')).includes('created 3 days ago'));
check('notes nav item shown', (await page.getAttribute('.desktop-side-nav [data-count-item="notes"]', 'hidden')) === null);
if (shots) await page.screenshot({ path: `${shots}/community-notes.png`, clip: { x: 0, y: 450, width: 1280, height: 450 } });

// 7. phone: open the editor, no sideways scroll
const phone = await ctx.newPage();
await phone.setViewportSize({ width: 375, height: 812 });
await phone.goto(`${B}/${SID}`);
await phone.waitForSelector('.add-example .toggle-link');
await phone.click('.add-example .toggle-link');
const sw = await phone.evaluate(() => document.documentElement.scrollWidth);
check('phone editor no sideways scroll', sw <= 375, String(sw));
check('no JS errors', errors.length === 0, errors.join(' | '));
await browser.close();
console.log(`${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
