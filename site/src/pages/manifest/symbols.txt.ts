import type { APIRoute } from 'astro';
import { symbolsTxt } from '../../lib/search-index';

export const GET: APIRoute = () => new Response(symbolsTxt, { headers: { 'Content-Type': 'text/plain' } });
