"""Parse the Sphinx HTML of the pinned docs build.

For each `<dl class="py ...">` block: signatures (one per `<dt>`), the kind
markers in front of the name (class, async, classmethod, ...), versionadded,
versionchanged, deprecated / deprecated-removed, availability, "CPython
implementation detail", the first paragraph, and `>>>` snippets. Nested
`<dl class="py ...">` blocks (methods inside a class) are parsed on their own
and are excluded from the parent block.

The HTML is untrusted input. It is only parsed with lxml.
"""

import copy
import re
from dataclasses import dataclass, field
from pathlib import Path

import lxml.html

_WS = re.compile(r"\s+")


def classes(el) -> list[str]:
    return (el.get("class") or "").split()


def is_py_dl(el) -> bool:
    return el.tag == "dl" and "py" in classes(el)


def clean(s: str) -> str:
    return _WS.sub(" ", s.replace("¶", "")).strip()


def text(el) -> str:
    return clean(el.text_content())


def iter_own(el, stop=is_py_dl):
    """Yield descendants of `el`, skipping subtrees whose root matches `stop`."""
    for child in el:
        if not isinstance(child.tag, str):
            continue
        if stop(child):
            continue
        yield child
        yield from iter_own(child, stop)


def _has_class(el, name: str) -> bool:
    return name in classes(el)


# --- version / deprecation / availability --------------------------------

_V = r"(\d+(?:\.\d+)*)"
_ADDED = re.compile(rf"^Added in version {_V}[:.]?\s*(.*)$", re.S)
_CHANGED = re.compile(rf"^Changed in version {_V}[:.]?\s*(.*)$", re.S)
_SOFT = re.compile(rf"^Soft deprecated since version {_V}[:.]?\s*(.*)$", re.S)
_DEPRECATED = re.compile(
    rf"^Deprecated since version {_V}(?:,\s*(?:will be\s+)?removed in version {_V})?[:.]?\s*(.*)$",
    re.S,
)


def _admonition_text(div) -> str:
    return text(div)


def parse_admonitions(nodes) -> dict:
    """Collect version/deprecation/availability info from an iterable of nodes."""
    added: list[dict] = []
    changed: list[dict] = []
    deprecated = None
    availability: list[str] = []
    impl_detail = False
    for el in nodes:
        if el.tag != "div":
            continue
        cls = classes(el)
        if "versionadded" in cls:
            m = _ADDED.match(_admonition_text(el))
            if m:
                added.append({"version": m[1], "text": m[2].strip()})
        elif "versionchanged" in cls:
            t = _admonition_text(el)
            m = _SOFT.match(t)
            if m:
                changed.append({"version": m[1], "text": f"Soft deprecated. {m[2].strip()}".strip()})
                continue
            m = _CHANGED.match(t)
            if m:
                changed.append({"version": m[1], "text": m[2].strip()})
        elif "deprecated" in cls or "deprecated-removed" in cls:
            m = _DEPRECATED.match(_admonition_text(el))
            if m and deprecated is None:
                deprecated = {"version": m[1], "removedIn": m[2], "text": m[3].strip()}
        elif "availability" in cls:
            availability = availability or parse_availability(el)
        elif "impl-detail" in cls:
            impl_detail = True
    return {
        "added": added,
        "changed": changed,
        "deprecated": deprecated,
        "availability": availability,
        "implDetail": impl_detail,
    }


def _split_top_level(s: str) -> list[str]:
    out, depth, cur = [], 0, []
    for ch in s:
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth = max(0, depth - 1)
        if ch == "," and depth == 0:
            out.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
    out.append("".join(cur))
    return [p.strip() for p in out if p.strip()]


def parse_availability(div) -> list[str]:
    p = div.find(".//p")
    t = text(p if p is not None else div)
    if not t.startswith("Availability"):
        return []
    t = t.split(":", 1)[1].strip() if ":" in t else ""
    # Keep only the first sentence; later sentences are free-form notes.
    t = re.split(r"(?<=[a-zA-Z0-9)])\.(?:\s|$)", t, maxsplit=1)[0].strip().rstrip(".")
    return _split_top_level(t)


# --- signatures ------------------------------------------------------------


@dataclass
class DtSig:
    id: str | None
    name: str  # sig-name text, e.g. "split"
    prename: str  # e.g. "str." or "@functools."
    leading: list[str]  # kind markers before the name: class, async, ...
    rest: str | None  # everything after the name, e.g. "(sep=None, maxsplit=-1)"

    @property
    def is_decorator(self) -> bool:
        return self.prename.startswith("@")


def parse_dt(dt) -> DtSig:
    d = copy.deepcopy(dt)
    for a in d.xpath('.//a[contains(concat(" ", @class, " "), " headerlink ")]'):
        a.drop_tree()
    name_el = None
    for child in d:
        if isinstance(child.tag, str) and _has_class(child, "sig-name"):
            name_el = child
            break
    leading = []
    if name_el is not None:
        for child in list(d):
            if child is name_el:
                break
            if isinstance(child.tag, str) and child.tag == "em" and _has_class(child, "property"):
                leading.extend(text(child).split())
                child.drop_tree()
    prename = "".join(
        text(c) for c in d if isinstance(c.tag, str) and _has_class(c, "sig-prename")
    )
    name = text(name_el) if name_el is not None else ""
    full = text(d).replace("→", "->")
    head = prename + name
    has_sig = bool(
        d.xpath('.//span[contains(@class, "sig-paren")] | .//span[contains(@class, "sig-return")]')
    )
    if name_el is not None and not has_sig:
        # Type annotation or value after the name, e.g. "VALUE = 1", "x: int".
        has_sig = any(
            isinstance(c.tag, str) and c.tag == "em" and _has_class(c, "property")
            for c in name_el.itersiblings()
        )
    rest = full[len(head):] if has_sig and full.startswith(head) else None
    return DtSig(id=dt.get("id"), name=name, prename=prename, leading=leading, rest=rest)


# --- blocks ---------------------------------------------------------------


@dataclass
class Block:
    """One `<dl class="py ...">` element. Several ids can share it."""

    page: str
    dl_kind: str  # second class token: function, method, class, data, ...
    dts: list[DtSig]
    info: dict  # parse_admonitions() result
    first_paragraph: str | None
    doctests: list[str]

    def sigs_for(self, anchor: str) -> list[DtSig]:
        """The dt with this id plus the id-less dts that follow it."""
        out, current = [], None
        for dt in self.dts:
            if dt.id:
                current = dt.id
            if current == anchor:
                out.append(dt)
        return out


@dataclass
class ProseSnippet:
    page: str
    anchor: str  # nearest enclosing section id
    code: str
    order: int  # document order within the page


@dataclass
class ModuleSection:
    first_paragraph: str | None
    info: dict


@dataclass
class Page:
    path: str  # relative, e.g. "library/json.html"
    blocks: dict[str, Block] = field(default_factory=dict)  # dt id -> block
    dl_blocks: dict = field(default_factory=dict)  # dl element -> block
    prose_snippets: list[ProseSnippet] = field(default_factory=list)
    breadcrumbs: list[tuple[str, str]] = field(default_factory=list)  # (href, title)
    root: object = None  # lxml root, kept for module section lookup


def snippet_text(pre) -> str | None:
    t = pre.text_content().replace("\r\n", "\n")
    lines = [ln.rstrip() for ln in t.strip("\n").split("\n")]
    if not any(ln.startswith(">>>") for ln in lines):
        return None
    while lines and not lines[-1]:
        lines.pop()
    return "\n".join(lines)


def _first_paragraph(container, stop) -> str | None:
    for el in container:
        if not isinstance(el.tag, str) or stop(el):
            continue
        if el.tag == "p":
            t = text(el)
            if t and not t.startswith("Source code:"):
                return t
    return None


def _section_anchor(el) -> str:
    for anc in el.iterancestors():
        if anc.tag == "section" and anc.get("id"):
            return anc.get("id")
    return ""


def _borrowed_paragraph(dl, dl_blocks) -> str | None:
    own_dd = next((c for c in dl if isinstance(c.tag, str) and c.tag == "dd"), None)
    if own_dd is not None and text(own_dd):
        return None
    # Attribute tables: <td><dl>name</dl></td><td>description</td>.
    parent = dl.getparent()
    if parent is not None and parent.tag == "td":
        td = parent.getnext()
        while td is not None and td.tag != "td":
            td = td.getnext()
        if td is not None:
            return text(td) or None
        return None
    # Consecutive directives share the content of the last one:
    #   .. exception:: ExceptionGroup(...)
    #   .. exception:: BaseExceptionGroup(...)
    #      shared text
    sib = dl.getnext()
    while sib is not None and is_py_dl(sib) and sib in dl_blocks:
        dd = next((c for c in sib if isinstance(c.tag, str) and c.tag == "dd"), None)
        if dd is not None and text(dd):
            return dl_blocks[sib].first_paragraph
        sib = sib.getnext()
    return None


def _is_snippet_pre(el) -> bool:
    return el.tag == "pre" and el.getparent() is not None and _has_class(el.getparent(), "highlight")


def parse_page(docs_root: Path, rel: str) -> Page:
    root = lxml.html.parse(str(docs_root / rel)).getroot()
    page = Page(path=rel, root=root)
    body = root.xpath('//div[@role="main"]') or [root]
    main = body[0]

    for dl in main.iter("dl"):
        if not is_py_dl(dl):
            continue
        dts = [parse_dt(dt) for dt in dl if isinstance(dt.tag, str) and dt.tag == "dt"]
        dd = next((c for c in dl if isinstance(c.tag, str) and c.tag == "dd"), None)
        own = list(iter_own(dd)) if dd is not None else []
        info = parse_admonitions(own)
        doctests = []
        for el in own:
            if _is_snippet_pre(el):
                s = snippet_text(el)
                if s:
                    doctests.append(s)
        first_p = _first_paragraph(dd, is_py_dl) if dd is not None else None
        if first_p is None:
            for el in own:
                if el.tag == "p":
                    first_p = text(el) or None
                    if first_p:
                        break
        cls = classes(dl)
        block = Block(
            page=rel,
            dl_kind=cls[1] if len(cls) > 1 else "",
            dts=dts,
            info=info,
            first_paragraph=first_p,
            doctests=doctests,
        )
        page.dl_blocks[dl] = block
        for dt in dts:
            if dt.id and dt.id not in page.blocks:
                page.blocks[dt.id] = block

    # Blocks with an empty <dd> take their text from where the docs put it.
    for dl, block in page.dl_blocks.items():
        if block.first_paragraph is None:
            block.first_paragraph = _borrowed_paragraph(dl, page.dl_blocks)

    order = 0
    for pre in main.iter("pre"):
        if not _is_snippet_pre(pre):
            continue
        if any(is_py_dl(a) for a in pre.iterancestors()):
            continue
        s = snippet_text(pre)
        if s:
            page.prose_snippets.append(
                ProseSnippet(page=rel, anchor=_section_anchor(pre), code=s, order=order)
            )
            order += 1

    for li in root.xpath('//div[@role="navigation"]//li[contains(@class, "nav-item")]'):
        a = li.find("a")
        if a is not None and "nav-item-this" not in classes(li):
            page.breadcrumbs.append((a.get("href") or "", text(a)))
    # Two navigation bars (top and bottom) repeat the same crumbs.
    seen, crumbs = set(), []
    for c in page.breadcrumbs:
        if c not in seen:
            seen.add(c)
            crumbs.append(c)
    page.breadcrumbs = crumbs
    return page


@dataclass
class Lookup:
    block: Block | None
    sigs: list[DtSig]
    loose_text: str | None  # paragraph text when the anchor is not in a py block
    how: str  # "dt", "dl-alias", "loose", "missing"


def lookup(page: Page, anchor: str) -> Lookup:
    """Find the block documenting an inventory anchor.

    Most anchors are `<dt>` ids. Some are explicit targets: an id on the
    `<dl>` itself or on a `<span>` inside it (aliases such as `list.append`,
    which share the `sequence.append` block), or a `<p>` outside any block.
    """
    if anchor in page.blocks:
        block = page.blocks[anchor]
        return Lookup(block, block.sigs_for(anchor), None, "dt")
    el = page.root.get_element_by_id(anchor, None) if anchor else None
    if el is None:
        return Lookup(None, [], None, "missing")
    # An id on the <dl> or on a direct child of it (a <span> before the
    # first <dt>) names the whole block. An id deeper inside the <dd>, such
    # as <p id="functools.lru_cache.cache_info">, is a paragraph target.
    for cand in (el, el.getparent()):
        if cand is not None and is_py_dl(cand) and cand in page.dl_blocks:
            block = page.dl_blocks[cand]
            first = next((d.id for d in block.dts if d.id), None)
            return Lookup(block, block.sigs_for(first) if first else [], None, "dl-alias")
    p = el if el.tag == "p" else next((a for a in el.iterancestors() if a.tag == "p"), None)
    return Lookup(None, [], text(p) if p is not None else None, "loose")


def module_section(page: Page, anchor: str) -> ModuleSection | None:
    found = page.root.get_element_by_id(anchor, None)
    if found is None:
        return None
    section = found if found.tag == "section" else next(
        (a for a in found.iterancestors() if a.tag == "section"), None
    )
    if section is None:
        return None

    def stop(el):
        return el.tag == "section" or is_py_dl(el)

    own = list(iter_own(section, stop))
    return ModuleSection(
        first_paragraph=_first_paragraph(section, stop),
        info=parse_admonitions(own),
    )


def parse_modindex(docs_root: Path) -> dict[str, dict]:
    """Module name -> {synopsis, deprecated} from py-modindex.html."""
    root = lxml.html.parse(str(docs_root / "py-modindex.html")).getroot()
    out = {}
    for a in root.xpath('//table[contains(@class, "modindextable")]//a[code]'):
        name = text(a)
        td = a.getparent()
        nxt = td.getnext()
        if nxt is None:
            continue
        em = nxt.find(".//em")
        strong = nxt.find(".//strong")
        out[name] = {
            "synopsis": text(em) if em is not None else "",
            "deprecated": strong is not None and text(strong).startswith("Deprecated"),
        }
    return out


def parse_library_index(docs_root: Path) -> list[dict]:
    """Top-level chapters of library/index.html: [{title, href, pages}]."""
    root = lxml.html.parse(str(docs_root / "library" / "index.html")).getroot()
    chapters = []
    for li in root.xpath('//div[contains(@class, "toctree-wrapper")]/ul/li[contains(@class, "toctree-l1")]'):
        a = li.find("a")
        pages = [
            (sub.get("href") or "").split("#")[0]
            for sub in li.xpath('./ul/li[contains(@class, "toctree-l2")]/a')
        ]
        chapters.append({"title": text(a), "href": (a.get("href") or "").split("#")[0], "pages": pages})
    return chapters
