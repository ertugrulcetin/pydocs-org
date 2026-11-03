// Python syntax highlighting with ClojureDocs' token classes (tok-comment,
// tok-string, tok-keyword, tok-builtin, tok-def, tok-paren-0/1/2), so the reused
// CSS colors code the same way, light and dark. Used at build time (baked
// examples) and in the browser (live preview, new content). Output is escaped.

const KEYWORDS = new Set(
  ('False None True and as assert async await break class continue def del elif else except finally for from global if ' +
    'import in is lambda nonlocal not or pass raise return try while with yield match case').split(' '),
);
const BUILTINS = new Set(
  ('abs aiter all anext any ascii bin bool breakpoint bytearray bytes callable chr classmethod compile complex delattr dict dir ' +
    'divmod enumerate eval exec filter float format frozenset getattr globals hasattr hash help hex id input int isinstance ' +
    'issubclass iter len list locals map max memoryview min next object oct open ord pow print property range repr reversed ' +
    'round set setattr slice sorted staticmethod str sum super tuple type vars zip __import__ self cls').split(' '),
);

const TOKEN = new RegExp(
  [
    /(?<comment>#[^\n]*)/,
    /(?<string>[rRbBuUfF]{0,2}(?:'''[\s\S]*?(?:'''|$)|"""[\s\S]*?(?:"""|$)|'(?:\\.|[^'\\\n])*'?|"(?:\\.|[^"\\\n])*"?))/,
    /(?<decorator>@[A-Za-z_][\w.]*)/,
    /(?<name>[A-Za-z_]\w*)/,
    /(?<open>[([{])/,
    /(?<close>[)\]}])/,
  ]
    .map((r) => r.source)
    .join('|'),
  'g',
);

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const span = (cls: string, s: string) => `<span class="${cls}">${esc(s)}</span>`;

/** Returns highlighted HTML for the inside of a <pre class="syntaxify">. */
export function highlightPython(code: string): string {
  let out = '';
  let last = 0;
  let depth = 0;
  let prevName = '';
  for (const m of code.matchAll(TOKEN)) {
    out += esc(code.slice(last, m.index));
    last = m.index! + m[0].length;
    const g = m.groups!;
    if (g.comment) out += span('tok-comment', m[0]);
    else if (g.string) out += span('tok-string', m[0]);
    else if (g.decorator) out += span('tok-builtin', m[0]);
    else if (g.name) {
      const w = m[0];
      if (prevName === 'def' || prevName === 'class') out += span('tok-def', w);
      else if (KEYWORDS.has(w)) out += span('tok-keyword', w);
      else if (BUILTINS.has(w)) out += span('tok-builtin', w);
      else out += esc(w);
      prevName = w;
      continue;
    } else if (g.open) {
      out += span(`tok-paren-${depth % 3}`, m[0]);
      depth++;
    } else if (g.close) {
      depth = Math.max(0, depth - 1);
      out += span(`tok-paren-${depth % 3}`, m[0]);
    }
    prevName = '';
  }
  return out + esc(code.slice(last));
}
