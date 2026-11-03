"""Combine inventory, docs HTML, and introspection into PyDocs reference data."""

import re
import sys
import time
from collections import Counter, defaultdict
from dataclasses import dataclass, field

from . import config, docs_html, doctests, inventory, introspect
from .download import Inputs

CALLABLE_KINDS = {"function", "method", "classmethod", "staticmethod", "decorator", "class", "exception"}
GENERIC_SIGS = {"()", "(*args, **kwargs)", "(*args, **kwds)"}
# A versionadded note that describes a new parameter or feature of an
# existing object, not the object itself.
FEATURE_NOTE = re.compile(r"^(Added|Add|New)\b|\b(parameter|argument|keyword)s?\b", re.I)
# Prose outside these folders (reference/, howto/, ...) is not module prose.
PROSE_DIRS = ("library/", "builtins/")


@dataclass
class Result:
    symbols: dict[str, list[dict]]  # module -> symbols
    modules: list[dict]
    chapters: list[dict]
    doctests: dict[str, dict]  # module -> {"symbols": {...}, "unattached": [...]}
    stats: dict
    timings: dict = field(default_factory=dict)


def _version_key(v: str | None) -> tuple:
    return tuple(int(x) for x in v.split(".")) if v else ()


def _pick_added(entries: list[dict]) -> tuple[str | None, list[dict]]:
    added, extra = None, []
    for a in entries:
        if added is None and (not a["text"] or not FEATURE_NOTE.search(a["text"])):
            added = a["version"]
        elif a["text"]:
            extra.append({"version": a["version"], "text": a["text"]})
    return added, extra


def _kind(entry_kind: str, look: docs_html.Lookup, intro: dict | None) -> str:
    leading = {w for d in look.sigs for w in d.leading}
    if any(d.is_decorator for d in look.sigs):
        return "decorator"
    if "classmethod" in leading:
        return "classmethod"
    if "static" in leading or "staticmethod" in leading:
        return "staticmethod"
    if entry_kind == "method" and intro and intro.get("methodKind"):
        return intro["methodKind"]
    return entry_kind


def _signatures(qualname: str, look: docs_html.Lookup) -> list[str]:
    last = qualname.rsplit(".", 1)[-1]
    parent = qualname.rsplit(".", 1)[0] + "." if "." in qualname else ""
    out = []
    for d in look.sigs:
        if d.rest is None and not d.is_decorator:
            continue
        name = qualname if (d.name == last or look.how == "dl-alias") else parent + d.name
        # A decorator documented without arguments is shown as the docs
        # show it: "@contextmanager".
        sig = ("@" if d.is_decorator else "") + name + (d.rest or "")
        if sig not in out:
            out.append(sig)
    return out


def _parent(module: str, qualname: str, ids: set[str]) -> str | None:
    parts = qualname.split(".")
    for k in range(len(parts) - 1, 0, -1):
        pid = f"{module}/{'.'.join(parts[:k])}"
        if pid in ids:
            return pid
    return None


def build(inputs: Inputs, only: set[str] | None = None, jobs: int | None = None) -> Result:
    t0 = time.monotonic()
    timings = {}
    inv = inventory.load(inputs.inventory)
    all_ids = {s.id for s in inv.symbols}
    module_names = set(inv.modules)
    selected = set(module_names) if only is None else set(only)
    unknown = selected - module_names
    if unknown:
        raise SystemExit(f"unknown modules: {', '.join(sorted(unknown))}")

    by_module: dict[str, list[inventory.InvSymbol]] = defaultdict(list)
    for s in inv.symbols:
        by_module[s.module].append(s)

    # Which modules each page documents (from the whole inventory, so a
    # partial run resolves prose snippets exactly like a full run).
    page_modules: dict[str, set[str]] = defaultdict(set)
    page_home: dict[str, str] = {}
    for name, e in inv.modules.items():
        page_modules[e.page].add(name)
        page_home.setdefault(e.page, name)
    page_counts: dict[str, Counter] = defaultdict(Counter)
    for s in inv.symbols:
        page_modules[s.entry.page].add(s.module)
        page_counts[s.entry.page][s.module] += 1
    for page, c in page_counts.items():
        page_home.setdefault(page, c.most_common(1)[0][0])

    pages_needed = {page for page, mods in page_modules.items() if mods & selected}
    pages = {p: docs_html.parse_page(inputs.docs_root, p) for p in sorted(pages_needed)}
    modindex = docs_html.parse_modindex(inputs.docs_root)
    library_index = docs_html.parse_library_index(inputs.docs_root)
    timings["parse_html"] = time.monotonic() - t0

    t1 = time.monotonic()
    wanted = {
        m: [(s.qualname, s.entry.kind) for s in by_module.get(m, [])] for m in sorted(selected)
    }
    intro = introspect.introspect_all(wanted, jobs=jobs)
    timings["introspect"] = time.monotonic() - t1

    t2 = time.monotonic()
    stats = defaultdict(Counter)
    lists = defaultdict(list)
    symbols_out: dict[str, list[dict]] = {}
    block_snippets = []
    module_sections = {
        m: docs_html.module_section(pages[inv.modules[m].page], inv.modules[m].anchor) for m in sorted(selected)
    }
    for module in sorted(selected):
        mres = intro[module]
        # A module-wide availability note ("Availability: Windows") applies
        # to every symbol that has no note of its own.
        msec = module_sections[module]
        module_availability = msec.info["availability"] if msec else []
        records = []
        for s in by_module.get(module, []):
            page = pages[s.entry.page]
            look = docs_html.lookup(page, s.entry.anchor)
            stats["docsBlock"][look.how] += 1
            if look.how in ("loose", "missing"):
                lists[f"docsBlock.{look.how}"].append(s.id)
            si = mres.symbols.get(s.qualname) if mres.status == "ok" else None
            if si is not None and not si.get("resolved"):
                lists["introspection.unresolved"].append(s.id)
                si = None
            stats["introspection"]["resolved" if si else ("unresolved" if mres.status == "ok" else mres.status)] += 1
            if si and si.get("errors"):
                lists["introspection.errors"].append(f"{s.id}: {'; '.join(si['errors'])}")

            block = look.block
            info = block.info if block else docs_html.parse_admonitions([])
            kind = _kind(s.entry.kind, look, si)
            sigs = _signatures(s.qualname, look)
            if sigs:
                stats["signature"]["docs"] += 1
            elif kind in CALLABLE_KINDS and si and si.get("signature"):
                sig = si["signature"]
                params = sig[len(s.qualname):]
                if kind in ("class", "exception") and params in GENERIC_SIGS:
                    stats["signature"]["none"] += 1
                    lists["signature.missingForCallable"].append(s.id)
                else:
                    sigs = [sig]
                    stats["signature"]["introspection"] += 1
            elif kind in CALLABLE_KINDS:
                stats["signature"]["none"] += 1
                lists["signature.missingForCallable"].append(s.id)
            else:
                stats["signature"]["notCallable"] += 1

            doc = si.get("doc") if si else None
            if doc:
                stats["doc"]["docstring"] += 1
            else:
                doc = (block.first_paragraph if block else None) or look.loose_text
                stats["doc"]["docsText" if doc else "missing"] += 1
                if not doc:
                    lists["doc.missing"].append(s.id)

            added, extra = _pick_added(info["added"])
            changed = sorted(info["changed"] + extra, key=lambda c: _version_key(c["version"]))
            leading = {w for d in look.sigs for w in d.leading}
            is_async = bool(si and si.get("isAsync")) or bool(leading & {"async", "awaitable"})
            rec = {
                "id": s.id,
                "module": module,
                "qualname": s.qualname,
                "name": s.qualname.rsplit(".", 1)[-1],
                "kind": kind,
                "parent": _parent(module, s.qualname, all_ids),
                "signatures": sigs,
                "doc": doc,
                "docsUrl": s.entry.docs_url,
                "added": added,
                "changed": changed,
                "deprecated": info["deprecated"],
                "availability": info["availability"] or module_availability,
                "source": si.get("source") if si else None,
                "implDetail": info["implDetail"],
                "isAsync": is_async,
            }
            records.append(rec)
            stats["kind"][kind] += 1
            for flag, on in (
                ("added", rec["added"]),
                ("changed", rec["changed"]),
                ("deprecated", rec["deprecated"]),
                ("availability", rec["availability"]),
                ("source", rec["source"]),
                ("implDetail", rec["implDetail"]),
                ("isAsync", rec["isAsync"]),
                ("parent", rec["parent"]),
            ):
                if on:
                    stats["fields"][flag] += 1
            if "." in s.qualname and not rec["parent"]:
                lists["parent.missing"].append(s.id)
            if block:
                for code in block.doctests:
                    block_snippets.append((s.id, id(block), code, s.entry.docs_url))
        records.sort(key=lambda r: (r["qualname"].casefold(), r["qualname"]))
        symbols_out[module] = records

    # Snippets of a block shared by several ids are attached to all of them.
    grouped: dict[tuple[int, str], dict] = {}
    for sid, bkey, code, url in block_snippets:
        g = grouped.setdefault((bkey, code), {"ids": [], "code": code, "url": url})
        g["ids"].append(sid)
    blocks_in = [(g["ids"], g["code"], g["url"]) for g in grouped.values()]

    idx = doctests.SymbolIndex.build(
        [(s.id, s.module, s.qualname, s.entry.kind, s.entry.page) for s in inv.symbols], module_names
    )
    prose_in = []
    for rel in sorted(pages):
        if not rel.startswith(PROSE_DIRS):
            continue
        mods = page_modules[rel]
        if not rel.startswith("builtins/"):
            # pickle.html documents object.__reduce__ etc.; a bare print()
            # there is not an example of builtins/print.
            mods = mods - {"builtins"}
        for sn in pages[rel].prose_snippets:
            url = config.DOCS_BASE_URL + rel + (f"#{sn.anchor}" if sn.anchor else "")
            prose_in.append((sn.code, rel, url, mods, page_home[rel]))
    attached = doctests.attach(blocks_in, prose_in, idx)

    doctests_out: dict[str, dict] = {}
    for module in sorted(selected):
        syms = {}
        for rec in symbols_out[module]:
            items = attached.by_symbol.get(rec["id"])
            if items:
                syms[rec["id"]] = items
        doctests_out[module] = {"symbols": syms, "unattached": attached.unattached.get(module, [])}
        for sid, items in syms.items():
            froms = {i["from"] for i in items}
            stats["doctests"]["symbolsWithDoctest"] += 1
            stats["doctests"]["fromBlock" if "block" in froms else "fromProseOnly"] += 1
            stats["doctests"]["attachments"] += len(items)
        stats["doctests"]["unattachedProseSnippets"] += len(doctests_out[module]["unattached"])
    stats["doctests"]["blockSnippets"] = sum(
        1 for ids, _, _ in blocks_in if any(i.split("/", 1)[0] in selected for i in ids)
    )
    stats["doctests"]["proseSnippets"] = sum(1 for p in prose_in if p[3] & selected)

    # Modules and chapters.
    chapter_by_href = {c["href"]: c for c in library_index}
    l2_index = {p: i for c in library_index for i, p in enumerate(c["pages"])}
    modules_out = []
    chapter_members: dict[str, list[tuple]] = defaultdict(list)
    inv_order = {name: i for i, name in enumerate(inv.modules)}
    for module in sorted(selected):
        e = inv.modules[module]
        page = pages[e.page]
        sec = module_sections[module]
        mres = intro[module]
        chapter, order_page = None, None
        crumbs = page.breadcrumbs
        if crumbs and crumbs[0][1] == "The Python standard library" and e.page.startswith("library/"):
            if len(crumbs) >= 2:
                chapter = chapter_by_href.get(crumbs[1][0])
                order_page = crumbs[2][0] if len(crumbs) >= 3 else e.page.removeprefix("library/")
        if chapter is None:
            lists["module.noChapter"].append(module)
        else:
            chapter_members[chapter["title"]].append((l2_index.get(order_page, 999), inv_order[module], module))
        doc = mres.doc if mres.status == "ok" and mres.doc else None
        if not doc and sec:
            doc = sec.first_paragraph
        info = sec.info if sec else docs_html.parse_admonitions([])
        deprecated = info["deprecated"]
        if deprecated is None and modindex.get(module, {}).get("deprecated"):
            deprecated = {"version": None, "removedIn": None, "text": modindex[module]["synopsis"]}
        synopsis = modindex.get(module, {}).get("synopsis", "")
        if not synopsis and doc:
            # A few modules (email.mime.*, urllib, compression) have no
            # synopsis in the module index; use the first sentence.
            synopsis = re.split(r"(?<=\.)\s|\n\s*\n", doc.strip(), maxsplit=1)[0].replace("\n", " ")[:200]
            lists["module.synopsisFromDoc"].append(module)
        modules_out.append(
            {
                "name": module,
                "synopsis": synopsis,
                "doc": doc,
                "chapter": chapter["title"] if chapter else None,
                "docsUrl": e.docs_url,
                "availability": info["availability"],
                "deprecated": deprecated,
            }
        )
        stats["modules"][mres.status] += 1
        if mres.status != "ok":
            lists[f"modules.{mres.status}"].append(f"{module}: {mres.reason}")
        if not synopsis:
            lists["module.noSynopsis"].append(module)
    chapters_out = []
    for c in library_index:
        members = sorted(chapter_members.get(c["title"], []))
        if members:
            chapters_out.append({"title": c["title"], "modules": [m for *_, m in members]})
    timings["assemble"] = time.monotonic() - t2

    final_stats = {
        "python": sys.version.split()[0],
        "platform": sys.platform,
        "inventorySource": inputs.inventory_source,
        "inventoryRoles": dict(sorted(inv.role_counts.items())),
        "symbols": sum(len(v) for v in symbols_out.values()),
        "modules": len(modules_out),
        "counts": {k: dict(sorted(v.items())) for k, v in sorted(stats.items())},
        "skipList": {m: config.SKIP_IMPORT[m] for m in sorted(config.SKIP_IMPORT)},
        "lists": {k: sorted(v) for k, v in sorted(lists.items())},
    }
    return Result(symbols_out, modules_out, chapters_out, doctests_out, final_stats, timings)
