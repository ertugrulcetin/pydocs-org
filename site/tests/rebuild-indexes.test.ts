import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contributionsFromSymbols } from '../scripts/rebuild-indexes.mjs';

test('contributions are rebuilt from symbol docs, oldest first, per author', () => {
  const a = { id: 1, login: 'ann' };
  const b = { id: 2, login: 'bob' };
  const symbols = {
    'builtins/len': {
      symbol: 'builtins/len',
      examples: [{ id: 'ex_B', author: a, createdAt: 20 }, { id: 'ex_A', author: b, createdAt: 10 }],
      seeAlsos: [{ id: 'sa_1', to: 'builtins/str', author: a, createdAt: 5 }],
      notes: [],
      updatedAt: 20,
    },
    're/sub': { symbol: 're/sub', examples: [], seeAlsos: [], notes: [{ id: 'nt_1', author: b, createdAt: 30 }], updatedAt: 30 },
  };
  const m = contributionsFromSymbols(symbols as never);
  assert.deepEqual(m.get(1)!.items.map((c: { id: string }) => c.id), ['sa_1', 'ex_B']);
  assert.deepEqual(m.get(2)!.items.map((c: { type: string; symbol: string }) => `${c.type}:${c.symbol}`), ['example:builtins/len', 'note:re/sub']);
});
