// Browser test of search: autocomplete keys, navigation, home box, /search
// paging, phone width, mobile menu. Usage: node e2e/search.mjs [baseUrl]
import { chromium } from 'playwright';
const B = process.argv[2] ?? 'http://localhost:4321';
const shots = process.env.SHOTS; // optional screenshot folder
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => m.type() === 'error' && !/status of (404|422)/.test(m.text()) && errors.push(m.text()));
let failed = 0;
const check = (label, ok, extra = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label} ${extra}`);
};

await page.goto(`${B}/builtins/len`);
await page.keyboard.press('Control+s');
const focused = await page.evaluate(() => document.activeElement?.matches('.desktop-nav-bar input.query'));
check('ctrl-s focuses navbar search', focused);
await page.keyboard.type('Counter');
await page.waitForSelector('.desktop-nav-bar .ac-results li#ac-0');
const first = await page.textContent('.desktop-nav-bar .ac-results li#ac-0 h4');
check('autocomplete shows results', first?.includes('Counter (collections)'), first);
check('body.search-active set', await page.evaluate(() => document.body.classList.contains('search-active')));
if (shots) await page.screenshot({ path: `${shots}/ac-desktop.png` });
await page.keyboard.press('ArrowDown');
const hl = await page.getAttribute('.desktop-nav-bar .ac-results li.highlighted', 'id');
check('ArrowDown moves highlight', hl === 'ac-1', hl);
await page.keyboard.press('Control+p');
check('ctrl-p moves back', (await page.getAttribute('.desktop-nav-bar .ac-results li.highlighted', 'id')) === 'ac-0');
await Promise.all([page.waitForURL('**/collections/Counter'), page.keyboard.press('Enter')]);
check('Enter opens highlighted', page.url().endsWith('/collections/Counter'), page.url());

await page.click('.desktop-nav-bar input.query');
await page.keyboard.type('zzzqqq');
await page.waitForSelector('.desktop-nav-bar .ac-results li.null-state');
check('Nothing Found state', true);
await page.keyboard.press('Escape');
check('Esc clears', (await page.inputValue('.desktop-nav-bar input.query')) === '' && !(await page.evaluate(() => document.body.classList.contains('search-active'))));

await page.goto(`${B}/`);
await page.keyboard.type('os.path.jo');
await page.waitForSelector('.quick-lookup-wrapper .ac-results li#ac-0');
check('home autocomplete', (await page.textContent('.quick-lookup-wrapper li#ac-0 h4'))?.includes('join (os.path)'));
if (shots) await page.screenshot({ path: `${shots}/ac-home.png` });

await page.goto(`${B}/search?q=split`);
await page.waitForSelector('ul.search-results li.search-result');
const n = await page.$$eval('li.search-result', (l) => l.length);
const hdr = await page.textContent('.search-results-header p');
check('/search renders 10 results', n === 10, hdr);
if (shots) await page.screenshot({ path: `${shots}/search-page.png` });
await page.click('text=next page');
await page.waitForURL('**page=2');
await page.waitForSelector('ul.search-results li.search-result');
check('next page works', (await page.textContent('.search-results-header p'))?.startsWith('11 to'));

const phone = await browser.newPage({ viewport: { width: 375, height: 812 } });
await phone.goto(`${B}/builtins/len`);
await phone.click('.mobile-nav-bar input.query');
await phone.keyboard.type('dumps');
await phone.waitForSelector('.mobile-nav-bar .ac-results li#ac-0');
check('phone autocomplete', (await phone.textContent('.mobile-nav-bar li#ac-0 h4'))?.includes('dumps (json)'));
check('phone no sideways scroll', (await phone.evaluate(() => document.documentElement.scrollWidth)) <= 375);
if (shots) await phone.screenshot({ path: `${shots}/ac-phone.png` });
await phone.click('.mobile-nav-bar .btn.mobile-menu');
await phone.waitForTimeout(400);
check('mobile menu opens', await phone.evaluate(() => document.querySelector('.mobile-nav-menu').classList.contains('mobile-push')));
if (shots) await phone.screenshot({ path: `${shots}/menu-phone.png` });
check('no JS errors', errors.length === 0, errors.join(' | '));
await browser.close();
process.exit(failed ? 1 : 0);
