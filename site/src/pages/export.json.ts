// Full community data export, CC0 (PLAN.md §5 #29–30): every symbol's
// examples, see-alsos and notes as of the last build.
import type { APIRoute } from 'astro';
import { bakedAt, bakedDocs } from '../lib/community-data';

export const GET: APIRoute = () =>
  new Response(
    JSON.stringify({
      license: 'CC0-1.0',
      licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
      source: 'https://pydocs.org',
      snapshotAt: bakedAt ? new Date(bakedAt).toISOString() : null,
      symbols: Object.values(bakedDocs).sort((a, b) => (a.symbol < b.symbol ? -1 : 1)),
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
