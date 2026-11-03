// Browser test of the example runner (Pyodide in a sandboxed iframe).
// Usage: node e2e/runner.mjs [baseUrl]
import { chromium } from 'playwright';

const B = process.argv[2] ?? 'http://localhost:4321';
let failed = 0;
const check = (label, ok, extra = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${extra}`);
};
const doc = (body, symbol = 'builtins/eval') => ({
  symbol,
  seeAlsos: [],
  notes: [],
  updatedAt: Date.now(), // newer than the baked copy, so the page shows this doc
  examples: [{ id: 'ex_01JBX0000000000000000000AA', body, author: { id: 0, login: 'python-docs' }, editors: [], createdAt: 1, updatedAt: 1, source: 'python-docs' }],
});

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const errors = [];
let body = ">>> x = 1\n>>> eval('x+1')\n2\n>>> print('hi'); [i * i for i in range(4)]\nhi\n[0, 1, 4, 9]";
// Serve the symbol doc on both read paths (data.pydocs.org in production, /api/s elsewhere).
await ctx.route(/(\/api\/s\/builtins\/eval$)|(data\.pydocs\.org\/symbols\/builtins\/eval\.json)/, (r) =>
  r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(doc(body)) }),
);
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/status of 404/.test(m.text()) && errors.push(m.text()));

const run = async () => {
  await page.click('.var-example .run-example');
  await page.waitForSelector('.example-output pre', { timeout: 120_000 });
  return { head: await page.textContent('.example-output-head span'), out: await page.textContent('.example-output pre') };
};

await page.goto(`${B}/builtins/eval`);
await page.waitForSelector('.var-example .run-example');
const t0 = Date.now();
let r = await run();
check('doctest example runs (REPL-style output)', r.out === "2\nhi\n[0, 1, 4, 9]\n", JSON.stringify(r.out));
check('output names the Python version', /^Output · Python 3\.\d+\.\d+ in your browser$/.test(r.head), `${r.head} (first run ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
check('builtins: nothing is imported first', !(await page.$('.example-output-note')));

// Seeded doctests assume their module is imported: run with "import collections"
// and "from collections import Counter" first, and say so.
const counter = ">>> Counter('abracadabra').most_common(2)\n[('a', 5), ('b', 2)]";
await ctx.route(/(\/api\/s\/collections\/Counter\.most_common$)|(data\.pydocs\.org\/symbols\/collections\/Counter\.most_common\.json)/, (r) =>
  r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(doc(counter, 'collections/Counter.most_common')) }),
);
await page.goto(`${B}/collections/Counter.most_common`);
await page.waitForSelector('.var-example .run-example');
r = await run();
check('example runs with its module and symbol imported', r.out === "[('a', 5), ('b', 2)]\n", JSON.stringify(r.out));
check(
  'the imports are shown',
  (await page.textContent('.example-output-note'))?.replace(/\s+/g, ' ').trim() === 'Imported first: import collections, from collections import Counter',
  JSON.stringify(await page.textContent('.example-output-note')),
);

// Plain script with an error: traceback without the runner's own frame.
body = 'import math\nmath.sqrt(16)\n1 / 0';
await page.goto('about:blank');
await page.goto(`${B}/builtins/eval`);
await page.waitForSelector('.var-example .run-example');
r = await run();
check('script: values then traceback', r.out.startsWith('4.0\nTraceback') && r.out.includes('ZeroDivisionError') && !r.out.includes('_pydocs_run'), JSON.stringify(r.out.slice(0, 120)));

// Sandbox: the runner cannot read the page's cookies or call our API with them.
body = "import js\nprint(js.document.cookie if hasattr(js, 'document') else 'no document')\nprint(js.self.origin)";
await ctx.addCookies([{ name: 'pd_user', value: 'secret', url: B }]);
await page.goto('about:blank');
await page.goto(`${B}/builtins/eval`);
await page.waitForSelector('.var-example .run-example');
r = await run();
check('runner has an opaque origin and no cookies', r.out.includes('no document') && r.out.includes('null'), JSON.stringify(r.out));

// Runaway loop is stopped and the page stays usable.
body = 'while True:\n    pass';
await page.goto('about:blank');
await page.goto(`${B}/builtins/eval`);
await page.waitForSelector('.var-example .run-example');
await run();
check('infinite loop is stopped', (await page.textContent('.example-output pre')).includes('more than 10 seconds'));
// The editor's Run tab runs the draft (logged-in UI; the fake API is not needed for this).
await ctx.addCookies([{ name: 'pd_user', value: Buffer.from(JSON.stringify({ id: 200, login: 'bob' })).toString('base64url'), url: B }]);
await page.goto('about:blank');
await page.goto(`${B}/builtins/eval`);
await page.click('.add-example .toggle-link');
await page.fill('.add-example textarea', 'sorted([3, 1, 2])');
await page.click('.add-example .nav-tabs a:has-text("Run")');
await page.waitForSelector('.add-example .example-output pre', { timeout: 120_000 });
check('editor Run tab shows the draft output', (await page.textContent('.add-example .example-output pre')) === '[1, 2, 3]\n');
check('no JS errors', errors.length === 0, errors.join(' | '));
await browser.close();
process.exit(failed ? 1 : 0);
