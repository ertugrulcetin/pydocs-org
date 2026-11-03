// Load check (PLAN.md Phase 6): a write to a very large symbol doc must stay far
// below the Workers free plan's 10 ms CPU per request. Node on a laptop is
// roughly as fast as a Worker isolate, so the budget here is 5 ms (half the limit).
// The per-symbol limits (100 examples of at most 10,000 chars) bound the doc at
// about 1 MB; this test uses that worst case.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.ts';
import { signSession } from '../worker/session.ts';
import { resetManifestCache } from '../worker/manifest.ts';
import { makeCtx, makeEnv, SECRET } from './fakes.ts';

test('write to the largest allowed symbol doc (~1 MB) costs well under 10 ms CPU', async () => {
  const env = makeEnv();
  resetManifestCache();
  const author = { id: 100, login: 'alice' };
  const big = {
    symbol: 'builtins/len',
    examples: Array.from({ length: 99 }, (_, i) => ({
      id: `ex_01JBX${String(i).padStart(21, '0')}`,
      body: `# example ${i}\n` + 'print(len([1, 2, 3]))  # => 3\n'.repeat(330), // ~9,900 chars
      author,
      editors: [author],
      createdAt: 1,
      updatedAt: 1,
      source: null,
    })),
    seeAlsos: [],
    notes: [],
    updatedAt: 1,
  };
  await env.content.put('symbols/builtins/len.json', JSON.stringify(big));
  const size = JSON.stringify(big).length;
  const now = Date.now();
  const cookie = `pd_session=${await signSession({ uid: 1, login: 'admin', ghc: 0, iat: now, exp: now + 60_000 }, SECRET)}`;
  const post = async () => {
    const ctx = makeCtx();
    const res = await worker.fetch(
      new Request('https://pydocs.org/api/s/builtins/len/examples', {
        method: 'POST',
        headers: { Origin: 'https://pydocs.org', Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'len("abc")  # => 3' }),
      }),
      env as never,
      ctx as never,
    );
    await ctx.settle();
    return res.status;
  };
  await post(); // warm up (manifest load, JIT)
  // Each run adds one example; reset to 99 so every write hits the 100th slot.
  const runs = 20;
  let total = 0;
  for (let i = 0; i < runs; i++) {
    await env.content.put('symbols/builtins/len.json', JSON.stringify(big));
    const t0 = process.cpuUsage();
    assert.equal(await post(), 200);
    const d = process.cpuUsage(t0);
    total += d.user + d.system;
  }
  const perWriteMs = total / 1000 / runs;
  console.log(`  doc ${(size / 1024).toFixed(0)} KB: ${perWriteMs.toFixed(2)} ms CPU per write (includes the fake R2 work)`);
  assert.ok(perWriteMs < 5, `${perWriteMs.toFixed(2)} ms per write`);
});
