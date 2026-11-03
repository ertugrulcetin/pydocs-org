import { test } from 'node:test';
import assert from 'node:assert/strict';
import { highlightPython } from '../src/lib/highlight.ts';

test('tokens get ClojureDocs classes', () => {
  const h = highlightPython("def f(x):  # doc\n    return len([x, 'a'])");
  assert.match(h, /<span class="tok-keyword">def<\/span> <span class="tok-def">f<\/span>/);
  assert.match(h, /<span class="tok-comment"># doc<\/span>/);
  assert.match(h, /<span class="tok-builtin">len<\/span><span class="tok-paren-0">\(<\/span><span class="tok-paren-1">\[<\/span>/);
  assert.match(h, /<span class="tok-string">'a'<\/span>/);
});

test('strings: triple-quoted, prefixed, with # inside; unterminated does not throw', () => {
  assert.match(highlightPython('x = f"a#b"'), /<span class="tok-string">f"a#b"<\/span>/);
  assert.match(highlightPython('"""doc\nmore"""'), /<span class="tok-string">"""doc\nmore"""<\/span>/);
  assert.doesNotThrow(() => highlightPython('s = "open'));
});

test('output is escaped (no HTML injection)', () => {
  const h = highlightPython('print("<script>alert(1)</script>") # <b>');
  assert.doesNotMatch(h, /<script>|<b>/);
  assert.match(h, /&lt;script&gt;/);
});

test('text survives round trip', () => {
  const src = ">>> import os.path\n>>> os.path.join('a', 'b')\n'a/b'\n@dataclass\nclass P: x: int = 1_000 # c";
  const text = highlightPython(src).replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  assert.equal(text, src);
});
