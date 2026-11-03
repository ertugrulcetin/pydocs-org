"""Invariants of the committed data/py-3.15/ output."""

import json

import pytest

from pydocs_extract import config

KINDS = {
    "function", "method", "classmethod", "staticmethod", "class", "exception",
    "attribute", "data", "property", "decorator",
}
FIELDS = [
    "id", "module", "qualname", "name", "kind", "parent", "signatures", "doc", "docsUrl",
    "added", "changed", "deprecated", "availability", "source", "implDetail", "isAsync",
]

OUT = config.OUT_DIR
pytestmark = pytest.mark.skipif(not (OUT / "meta.json").exists(), reason="data/py-3.15 not generated")


@pytest.fixture(scope="module")
def data():
    load = lambda p: json.loads(p.read_text(encoding="utf-8"))  # noqa: E731
    modules = load(OUT / "modules.json")
    symbols = {m["name"]: load(OUT / "symbols" / f"{m['name']}.json") for m in modules}
    doctests = {m["name"]: load(OUT / "doctests" / f"{m['name']}.json") for m in modules}
    return {
        "meta": load(OUT / "meta.json"),
        "chapters": load(OUT / "chapters.json"),
        "modules": modules,
        "symbols": symbols,
        "doctests": doctests,
    }


def test_meta_counts(data):
    meta = data["meta"]
    assert meta["python"] == config.PYTHON_VERSION_STR
    n = sum(len(v) for v in data["symbols"].values())
    assert meta["counts"]["symbols"] == n
    assert meta["counts"]["modules"] == len(data["modules"])
    assert sum(meta["counts"]["byKind"].values()) == n
    # Pages: symbols + modules + ~20 others must stay under the build check.
    assert n + len(data["modules"]) + 20 < 18_000


def test_symbols_shape(data):
    ids = set()
    for module, recs in data["symbols"].items():
        for r in recs:
            assert list(r) == FIELDS
            assert r["id"] == f"{module}/{r['qualname']}"
            assert r["id"] not in ids
            ids.add(r["id"])
            assert r["kind"] in KINDS
            assert r["docsUrl"].startswith(config.DOCS_BASE_URL)
            if r["source"]:
                assert r["source"]["path"].startswith("Lib/") and r["source"]["line"] >= 1
    for recs in data["symbols"].values():
        for r in recs:
            assert r["parent"] is None or r["parent"] in ids


def test_chapters_cover_modules(data):
    in_chapters = [m for c in data["chapters"] for m in c["modules"]]
    assert len(in_chapters) == len(set(in_chapters))
    assert set(in_chapters) == {m["name"] for m in data["modules"]}


def test_doctests_reference_known_symbols(data):
    for module, d in data["doctests"].items():
        ids = {r["id"] for r in data["symbols"][module]}
        for sid, items in d["symbols"].items():
            assert sid in ids
            assert items and all(i["from"] in ("block", "prose") for i in items)
            froms = [i["from"] for i in items]
            assert froms == sorted(froms)  # "block" before "prose"
            assert all(">>>" in i["code"] for i in items)
