// Static server for site/dist that behaves like Workers static assets for the
// browser tests: clean URLs (/os.path -> os.path.html), the real _headers
// rules (incl. "! Name" to remove a header) and _redirects 200 rewrites. So CI
// tests pages under the production CSP. /api/* is not served (tests mock it).
// Usage: node e2e/serve.mjs [port]   (default 4321)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const PORT = Number(process.argv[2] ?? 4321);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.wasm': 'application/wasm', '.zip': 'application/zip', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.gif': 'image/gif', '.woff': 'font/woff', '.ttf': 'font/ttf', '.txt': 'text/plain', '.xml': 'application/xml',
};

const toRegex = (pattern) => new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);

function parseHeaders(text) {
  const rules = [];
  let rule = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '');
    if (!line.trim()) continue;
    if (!/^\s/.test(line)) {
      rule = { re: toRegex(line.trim()), set: [], remove: [] };
      rules.push(rule);
    } else if (rule) {
      const l = line.trim();
      if (l.startsWith('!')) rule.remove.push(l.slice(1).trim().toLowerCase());
      else {
        const i = l.indexOf(':');
        rule.set.push([l.slice(0, i).trim().toLowerCase(), l.slice(i + 1).trim()]);
      }
    }
  }
  return rules;
}

function parseRedirects(text) {
  return text
    .split('\n')
    .map((l) => l.replace(/#.*$/, '').trim())
    .filter(Boolean)
    .map((l) => l.split(/\s+/))
    .filter(([, , status]) => status === '200')
    .map(([from, to]) => ({ re: toRegex(from), to }));
}

const headerRules = parseHeaders(await readFile(join(DIST, '_headers'), 'utf8').catch(() => ''));
const rewrites = parseRedirects(await readFile(join(DIST, '_redirects'), 'utf8').catch(() => ''));

async function resolveFile(path) {
  for (const candidate of [path, `${path}.html`, join(path, 'index.html')]) {
    try {
      return { file: candidate, body: await readFile(join(DIST, candidate)) };
    } catch {}
  }
  return null;
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let path = decodeURIComponent(url.pathname);
  if (path.startsWith('/api/') || path.startsWith('/auth/')) return res.writeHead(404, { 'Content-Type': 'application/json' }).end('{"message":"Not found."}');
  const rewrite = rewrites.find((r) => r.re.test(path));
  const target = rewrite ? rewrite.to : path;
  let found = await resolveFile(target === '/' ? '/index' : target);
  let status = 200;
  if (!found) {
    found = await resolveFile('/404');
    status = 404;
  }
  const headers = {};
  for (const rule of headerRules) {
    if (!rule.re.test(path)) continue;
    for (const name of rule.remove) delete headers[name];
    for (const [name, value] of rule.set) headers[name] = value;
  }
  headers['content-type'] = TYPES[extname(found.file)] ?? 'application/octet-stream';
  res.writeHead(status, headers).end(found.body);
}).listen(PORT, () => console.log(`serving ${DIST} on http://localhost:${PORT}`));
