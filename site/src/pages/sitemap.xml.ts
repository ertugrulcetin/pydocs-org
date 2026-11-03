// sitemap.xml (PLAN.md §5 #20): every module and symbol page plus the static
// pages. 11.5k URLs fits one sitemap (limit 50,000).
import type { APIRoute } from 'astro';
import { meta, modules, moduleUrl, symbols, symbolUrl } from '../lib/data';
import { SITE_URL } from '../lib/site';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

export const GET: APIRoute = () => {
  const lastmod = meta.generatedAt.slice(0, 10);
  const paths = ['/', '/library', '/library/all', '/quickref', ...modules.map((m) => moduleUrl(m.name)), ...symbols.map(symbolUrl)];
  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    paths.map((p) => `<url><loc>${esc(SITE_URL + p)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`).join('\n') +
    '\n</urlset>\n';
  return new Response(body, { headers: { 'Content-Type': 'application/xml' } });
};
