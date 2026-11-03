"""Parse a Sphinx objects.inv (version 2) into PyDocs symbols."""

import re
import zlib
from dataclasses import dataclass
from pathlib import Path

from . import config

_LINE = re.compile(r"(?P<name>.+?)\s+(?P<role>\S+:\S+)\s+(?P<prio>-?\d+)\s+(?P<uri>\S*)\s+(?P<disp>.*)")


@dataclass(frozen=True)
class Entry:
    name: str  # fully qualified, e.g. "os.path.join" or "str.split"
    kind: str  # inventory object type without "py:", e.g. "method"
    page: str  # e.g. "library/os.path.html"
    anchor: str  # e.g. "os.path.join"; "" for whole-page entries

    @property
    def uri(self) -> str:
        return f"{self.page}#{self.anchor}" if self.anchor else self.page

    @property
    def docs_url(self) -> str:
        return config.DOCS_BASE_URL + self.uri


@dataclass(frozen=True)
class InvSymbol:
    id: str
    module: str
    qualname: str
    entry: Entry


@dataclass
class Inventory:
    modules: dict[str, Entry]  # module name -> entry
    symbols: list[InvSymbol]  # every non-module py object, inventory order
    role_counts: dict[str, int]

    def by_id(self) -> dict[str, InvSymbol]:
        return {s.id: s for s in self.symbols}


def read_entries(path: Path) -> list[Entry]:
    data = path.read_bytes()
    header, sep, body = data.partition(b"# The remainder of this file is compressed using zlib.\n")
    if not sep or not header.startswith(b"# Sphinx inventory version 2"):
        raise ValueError(f"{path} is not a Sphinx v2 inventory")
    entries = []
    for line in zlib.decompress(body).decode("utf-8").splitlines():
        m = _LINE.match(line)
        if not m or not m["role"].startswith("py:"):
            continue
        name = m["name"]
        uri = m["uri"]
        if uri.endswith("$"):
            uri = uri[:-1] + name
        page, _, anchor = uri.partition("#")
        entries.append(Entry(name=name, kind=m["role"][3:], page=page, anchor=anchor))
    return entries


def split_name(name: str, modules: set[str]) -> tuple[str, str]:
    """Split a dotted inventory name into (module, qualname).

    The longest documented module that prefixes the name wins. Names with no
    module prefix ("len", "str.split", "object.__init__") are builtins.
    """
    parts = name.split(".")
    for k in range(len(parts) - 1, 0, -1):
        mod = ".".join(parts[:k])
        if mod in modules:
            return mod, ".".join(parts[k:])
    return "builtins", name


def load(path: Path) -> Inventory:
    entries = read_entries(path)
    role_counts: dict[str, int] = {}
    for e in entries:
        role_counts[e.kind] = role_counts.get(e.kind, 0) + 1
    modules = {e.name: e for e in entries if e.kind == "module"}
    names = set(modules)
    symbols = []
    seen = set()
    for e in entries:
        if e.kind == "module":
            continue
        module, qualname = split_name(e.name, names)
        sid = f"{module}/{qualname}"
        if sid in seen:  # the same name under two roles; keep the first
            continue
        seen.add(sid)
        symbols.append(InvSymbol(id=sid, module=module, qualname=qualname, entry=e))
    return Inventory(modules=modules, symbols=symbols, role_counts=role_counts)
