"""Attach `>>>` snippets to symbols, for seeding examples (PLAN.md, Phase 7).

1. A snippet inside a symbol's `<dl>` block belongs to that symbol (every id
   that shares the block).
2. A snippet in module prose (outside any `<dl>` block) belongs to each
   symbol it calls, when the call resolves to exactly one symbol of a module
   documented on that page. Calls into other modules (`print`, `sorted`,
   `Fraction` on the statistics page) are ignored.

The snippet code is only parsed with `ast`. It is never executed.
"""

import ast
import builtins
from collections import defaultdict
from dataclasses import dataclass, field

LITERAL_TYPES = {
    ast.List: "list",
    ast.ListComp: "list",
    ast.Dict: "dict",
    ast.DictComp: "dict",
    ast.Set: "set",
    ast.SetComp: "set",
    ast.Tuple: "tuple",
    ast.JoinedStr: "str",
}
CONST_TYPES = {str: "str", bytes: "bytes", int: "int", float: "float", complex: "complex"}

# A bare `open(...)` in a snippet is the builtin, not os.open or gzip.open.
BUILTIN_NAMES = frozenset(dir(builtins))
# `x.append(...)` on a receiver of unknown type is most likely a list, dict,
# str, ... method, so such names never resolve to a module's method.
GENERIC_METHODS = frozenset(
    name
    for t in (object, list, dict, set, frozenset, tuple, str, bytes, bytearray, int, float, complex)
    for name in dir(t)
)


def source_statements(code: str) -> list[str]:
    """The Python source of each `>>>` statement, without prompts and output."""
    stmts: list[list[str]] = []
    in_source = False
    for line in code.split("\n"):
        if line.startswith(">>>"):
            stmts.append([line[4:] if line.startswith(">>> ") else line[3:]])
            in_source = True
        elif in_source and line.startswith("..."):
            stmts[-1].append(line[4:] if line.startswith("... ") else line[3:])
        else:
            in_source = False
    return ["\n".join(s) for s in stmts]


@dataclass
class SymbolIndex:
    """Lookup tables over every symbol in the inventory."""

    ids: set[str]
    modules: set[str]
    kinds: dict[str, str]
    top_level: dict[str, dict[str, str]] = field(default_factory=dict)  # module -> name -> id
    members: dict[str, dict[str, list[str]]] = field(default_factory=dict)  # module -> attr -> ids
    pages: dict[str, str] = field(default_factory=dict)  # id -> docs page

    @classmethod
    def build(cls, symbols: list[tuple[str, str, str, str, str]], modules: set[str]) -> "SymbolIndex":
        """symbols: (id, module, qualname, kind, page)"""
        idx = cls(ids=set(), modules=set(modules), kinds={})
        for sid, module, qualname, kind, page in symbols:
            idx.ids.add(sid)
            idx.kinds[sid] = kind
            idx.pages[sid] = page
            if "." not in qualname:
                idx.top_level.setdefault(module, {})[qualname] = sid
            else:
                idx.members.setdefault(module, {}).setdefault(qualname.rsplit(".", 1)[1], []).append(sid)
        return idx

    def from_dotted(self, dotted: str) -> str | None:
        """'os.path.join' -> 'os.path/join' when that symbol exists."""
        parts = dotted.split(".")
        for k in range(len(parts) - 1, 0, -1):
            mod = ".".join(parts[:k])
            if mod in self.modules:
                sid = f"{mod}/{'.'.join(parts[k:])}"
                return sid if sid in self.ids else None
        return None


def _dotted(node) -> tuple[ast.AST, list[str]] | None:
    """Split `a.b.c` into (base node, ['b', 'c']) with `a` as base."""
    attrs = []
    while isinstance(node, ast.Attribute):
        attrs.append(node.attr)
        node = node.value
    return node, attrs[::-1]


class _Resolver:
    def __init__(self, idx: SymbolIndex, page_modules: set[str], page: str):
        self.idx = idx
        self.page_modules = page_modules
        self.page = page
        # name -> ("module", "os.path") | ("symbol", id) | ("instance", class id)
        self.env: dict[str, tuple[str, str]] = {}
        for m in page_modules:
            if m != "builtins":
                self.env.setdefault(m.split(".")[0], ("module", m.split(".")[0]))
        self.found: list[str] = []
        self.local: set[str] = set()  # names bound by the snippet itself

    # -- name resolution --------------------------------------------------

    def resolve(self, node) -> str | None:
        base, attrs = _dotted(node)
        if isinstance(base, ast.Name):
            bound = self.env.get(base.id)
            if bound:
                what, value = bound
                if what == "module":
                    return self._in_page(self.idx.from_dotted(".".join([value, *attrs])))
                if what == "symbol":
                    sid = value + ("." + ".".join(attrs) if attrs else "")
                    return self._in_page(sid if sid in self.idx.ids else None)
                if what == "instance" and len(attrs) == 1:
                    # Known type: its own method or nothing (inherited ones
                    # are documented elsewhere).
                    return self._in_page(f"{value}.{attrs[0]}" if f"{value}.{attrs[0]}" in self.idx.ids else None)
                return None
            if not attrs:
                return None if base.id in self.local else self._bare(base.id)
            if len(attrs) == 1:
                return self._member(attrs[0])
            return None
        if len(attrs) == 1:
            t = self._literal_type(base)
            if t:
                return self._in_page(f"builtins/{t}.{attrs[0]}")
            cls = self._class_of_call(base)
            if cls:
                return self._in_page(f"{cls}.{attrs[0]}" if f"{cls}.{attrs[0]}" in self.idx.ids else None)
            if isinstance(base, (ast.Call, ast.Subscript)):
                return self._member(attrs[0])
        return None

    def _ok(self, sid: str | None) -> bool:
        """A symbol of a module documented on this page. Builtins are used in
        every snippet, so for them the symbol itself must be on this page
        (a len() call in the stdtypes prose is not a len example)."""
        if not sid or sid not in self.idx.ids:
            return False
        module = sid.split("/", 1)[0]
        if module not in self.page_modules:
            return False
        return module != "builtins" or self.idx.pages.get(sid) == self.page

    def _in_page(self, sid: str | None) -> str | None:
        return sid if self._ok(sid) else None

    def _bare(self, name: str) -> str | None:
        if name in BUILTIN_NAMES and "builtins" not in self.page_modules:
            return None
        hits = {self.idx.top_level.get(m, {}).get(name) for m in self.page_modules}
        hits = {h for h in hits if self._ok(h)}
        return hits.pop() if len(hits) == 1 else None

    def _member(self, attr: str) -> str | None:
        if attr in GENERIC_METHODS and "builtins" not in self.page_modules:
            return None
        hits = set()
        for m in self.page_modules:
            hits.update(h for h in self.idx.members.get(m, {}).get(attr, []) if self._ok(h))
        return hits.pop() if len(hits) == 1 else None

    @staticmethod
    def _literal_type(node) -> str | None:
        if isinstance(node, ast.Constant):
            return CONST_TYPES.get(type(node.value))
        return LITERAL_TYPES.get(type(node))

    # -- walking ------------------------------------------------------------

    def _hit(self, sid: str | None):
        if sid and sid not in self.found:
            self.found.append(sid)

    def _class_of_call(self, value) -> str | None:
        if isinstance(value, ast.Call):
            sid = self.resolve(value.func)
            if sid and self.idx.kinds.get(sid) in ("class", "exception"):
                return sid
        return None

    def visit_statement(self, tree: ast.Module):
        for node in ast.walk(tree):
            if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store):
                self.local.add(node.id)
            elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                self.local.add(node.name)
            elif isinstance(node, ast.arg):
                self.local.add(node.arg)
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for a in node.names:
                    if a.asname:
                        self.env[a.asname] = ("module", a.name)
                    else:
                        top = a.name.split(".")[0]
                        self.env[top] = ("module", top)
            elif isinstance(node, ast.ImportFrom) and node.module and not node.level:
                for a in node.names:
                    name = a.asname or a.name
                    full = f"{node.module}.{a.name}"
                    if full in self.idx.modules:
                        self.env[name] = ("module", full)
                    else:
                        sid = f"{node.module}/{a.name}"
                        if sid in self.idx.ids:
                            self.env[name] = ("symbol", sid)
            elif isinstance(node, ast.Assign) and len(node.targets) == 1:
                cls = self._class_of_call(node.value)
                if cls and isinstance(node.targets[0], ast.Name):
                    self.env[node.targets[0].id] = ("instance", cls)
            elif isinstance(node, ast.withitem) and isinstance(node.optional_vars, ast.Name):
                cls = self._class_of_call(node.context_expr)
                if cls:
                    self.env[node.optional_vars.id] = ("instance", cls)
        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                self._hit(self.resolve(node.func))
            elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                for d in node.decorator_list:
                    self._hit(self.resolve(d.func if isinstance(d, ast.Call) else d))
                if isinstance(node, ast.ClassDef):
                    for b in node.bases:
                        self._hit(self.resolve(b))
            elif isinstance(node, ast.Expr) and isinstance(node.value, (ast.Name, ast.Attribute)):
                self._hit(self.resolve(node.value))


def called_symbols(code: str, idx: SymbolIndex, page_modules: set[str], page: str = "") -> list[str]:
    r = _Resolver(idx, page_modules, page)
    for src in source_statements(code):
        try:
            tree = ast.parse(src)
        except (SyntaxError, ValueError):
            continue
        r.visit_statement(tree)
    return r.found


@dataclass
class Attached:
    by_symbol: dict[str, list[dict]]
    unattached: dict[str, list[dict]]  # module -> snippets no symbol claimed


def attach(
    block_snippets: list[tuple[list[str], str, str]],
    prose_snippets: list[tuple[str, str, str, set[str], str]],
    idx: SymbolIndex,
) -> Attached:
    """block_snippets: (symbol ids sharing the block, code, url)
    prose_snippets: (code, page, url, page modules, home module)"""
    block: dict[str, list[dict]] = defaultdict(list)
    prose: dict[str, list[dict]] = defaultdict(list)
    unattached: dict[str, list[dict]] = defaultdict(list)
    for ids, code, url in block_snippets:
        for sid in ids:
            block[sid].append({"code": code, "from": "block", "url": url})
    for code, page, url, page_modules, home in prose_snippets:
        targets = called_symbols(code, idx, page_modules, page)
        if not targets:
            unattached[home].append({"code": code, "url": url})
            continue
        for sid in targets:
            prose[sid].append({"code": code, "from": "prose", "url": url, "targets": len(targets)})
    out: dict[str, list[dict]] = {}
    for sid in set(block) | set(prose):
        seen, items = set(), []
        for s in block.get(sid, []) + prose.get(sid, []):
            if s["code"] not in seen:
                seen.add(s["code"])
                items.append(s)
        out[sid] = items
    return Attached(out, dict(unattached))
