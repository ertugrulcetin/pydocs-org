import type { APIRoute } from 'astro';
import { docsJson } from '../../lib/search-index';

export const GET: APIRoute = () => new Response(docsJson, { headers: { 'Content-Type': 'application/json' } });
