import type { APIRoute } from 'astro';
import { acJson } from '../../lib/search-index';

export const GET: APIRoute = () => new Response(acJson, { headers: { 'Content-Type': 'application/json' } });
