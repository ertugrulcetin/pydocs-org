import type { APIRoute } from 'astro';
import { SITE_URL } from '../lib/site';

export const GET: APIRoute = () =>
  new Response(
    ['User-agent: *', 'Disallow: /api/', 'Disallow: /auth/', 'Disallow: /search', 'Disallow: /shell/', 'Disallow: /admin', '', `Sitemap: ${SITE_URL}/sitemap.xml`, ''].join('\n'),
    { headers: { 'Content-Type': 'text/plain' } },
  );
