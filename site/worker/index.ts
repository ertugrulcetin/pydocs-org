// The PyDocs Worker. It only sees /api/* and /auth/* (run_worker_first in
// wrangler.toml); everything else is served from static assets without it.
// Auth arrives in Phase 3 and the community API in Phase 4 (PLAN.md §8).

const json = (body: unknown, status = 200): Response =>
  Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });

export default {
  async fetch(req, _env): Promise<Response> {
    const { pathname } = new URL(req.url);

    if (pathname === '/api/health' && req.method === 'GET') {
      return json({ ok: true });
    }

    return json({ error: 'Not found' }, 404);
  },
} satisfies ExportedHandler<Env>;
