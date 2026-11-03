// Load check (PLAN.md Phase 6): a write to the largest allowed symbol doc must
// stay far below the Workers free plan's 10 ms CPU per request.
//
// The per-symbol limits (50 examples of at most 10,000 chars) bound a doc at
// about 500 KB; this test uses that worst case. Absolute timings on shared CI
// runners are unreliable (about 3x slower than a laptop), so the test checks:
//   - everywhere: a write costs at most 6x one bare JSON.parse + stringify of
//     the doc on the same machine (catches regressions such as extra copies);
//   - locally (CI unset): at most 5 ms, half the Workers limit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.ts';
import { signSession } from '../worker/session.ts';
import { resetManifestCache } from '../worker/manifest.ts';
import { makeCtx, makeEnv, SECRET } from './fakes.ts';

const cpuMs = (fn: () => void) => {
  const t0 = process.cpuUsage();
  fn();
  const d = process.cpuUsage(t0);
  return (d.user + d.system) / 1000;
};

test('write to the largest allowed symbol doc (~500 KB) stays well under the CPU limit', async () => {
  const env = makeEnv();
  resetManifestCache();
  const author = { id: 100, login: 'alice' };
  const big = {
    symbol: 'builtins/len',
    examples: Array.from({ length: 49 }, (_, i) => ({
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
  const raw = JSON.stringify(big);
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
  await env.content.put('symbols/builtins/len.json', raw);
  await post(); // warm up (manifest load, JIT)

  const runs = 20;
  let writes = 0;
  let baseline = 0;
  for (let i = 0; i < runs; i++) {
    await env.content.put('symbols/builtins/len.json', raw); // always the 50th slot
    baseline += cpuMs(() => JSON.stringify(JSON.parse(raw)));
    const t0 = process.cpuUsage();
    assert.equal(await post(), 200);
    const d = process.cpuUsage(t0);
    writes += (d.user + d.system) / 1000;
  }
  const perWrite = writes / runs;
  const perBaseline = baseline / runs;
  console.log(`  doc ${(raw.length / 1024).toFixed(0)} KB: ${perWrite.toFixed(2)} ms per write, ${(perWrite / perBaseline).toFixed(1)}x a bare parse+stringify`);
  assert.ok(perWrite <= 6 * perBaseline, `write costs ${(perWrite / perBaseline).toFixed(1)}x a bare parse+stringify`);
  if (!process.env.CI) assert.ok(perWrite < 5, `${perWrite.toFixed(2)} ms per write`);
});
