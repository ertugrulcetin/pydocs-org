// Run: node --test tests/  (Node 26 runs TypeScript directly)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepare, search, levenshtein, ellipsis } from '../src/scripts/search-core.ts';
import type { AcRow } from '../src/scripts/search-core.ts';

const rows: AcRow[] = [
  ['os.path', '', 0, 'Common pathname manipulations.'],
  ['os', '', 0, 'Miscellaneous operating system interfaces.'],
  ['builtins', 'len', 1, 'Return the number of items in a container.', 1],
  ['builtins', 'str.split', 2, 'Return a list of the substrings in the string.', 1],
  ['builtins', 'str.rsplit', 2, 'Return a list of the substrings, from the right.'],
  ['os.path', 'join', 1, 'Join one or more path segments.'],
  ['os.path', 'splitext', 1, 'Split the pathname into root and ext.'],
  ['re', 'split', 1, 'Split the source string by the occurrences of the pattern.', 1],
  ['shlex', 'split', 1, 'Split the string using shell-like syntax.'],
  ['logging', 'DEBUG', 8, 'Debug level.'],
  ['logging', 'debug', 1, 'Log a message with severity DEBUG.'],
];
const p = prepare(rows);
const names = (q: string, n = 5) => search(p, q, n).map((e) => e.fullName);

test('exact name beats prefix, builtins before other modules', () => {
  assert.deepEqual(names('split', 4), ['str.split', 're.split', 'shlex.split', 'os.path.splitext']);
});

test('dotted queries match full names', () => {
  assert.deepEqual(names('os.path.jo'), ['os.path.join']);
  assert.deepEqual(names('str.sp'), ['str.split']);
  assert.equal(names('builtins.len')[0], 'len');
});

test('modules rank first on exact module name', () => {
  assert.equal(names('os.path')[0], 'os.path');
});

test('case-only twins: exact case first', () => {
  assert.deepEqual(names('debug'), ['logging.debug', 'logging.DEBUG']);
  assert.deepEqual(names('DEBUG'), ['logging.DEBUG', 'logging.debug']);
});

test('no match and empty query', () => {
  assert.deepEqual(names('zzzz'), []);
  assert.deepEqual(names('   '), []);
});

test('helpers', () => {
  assert.equal(levenshtein('split', 'splitext'), 3);
  assert.equal(ellipsis(10, 'abcdefghijklmnop'), 'abcdefg...');
  assert.equal(ellipsis(10, 'short'), 'short');
});

test('real index: len and str.split are found first', () => {
  const dist = new URL('../dist/search-index/ac.json', import.meta.url);
  let real: AcRow[];
  try {
    real = JSON.parse(readFileSync(dist, 'utf8'));
  } catch {
    return; // build first to run this check
  }
  const rp = prepare(real);
  assert.equal(search(rp, 'len', 1)[0]!.href, '/builtins/len');
  assert.equal(search(rp, 'str.split', 1)[0]!.href, '/builtins/str.split');
  assert.equal(search(rp, 'os.path.join', 1)[0]!.href, '/os.path/join');
  assert.equal(search(rp, 'Counter', 1)[0]!.href, '/collections/Counter');
  assert.equal(search(rp, 'Path', 1)[0]!.href, '/pathlib/Path');
  assert.equal(search(rp, 'path', 1)[0]!.href, '/os.path');
  assert.equal(search(rp, 'dumps', 1)[0]!.href, '/json/dumps');
});
