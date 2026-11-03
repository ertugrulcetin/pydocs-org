import lxml.html

from pydocs_extract import docs_html, doctests
from pydocs_extract.build import _pick_added
from pydocs_extract.inventory import split_name

MODULES = {"os", "os.path", "xml.etree.ElementTree", "xml", "json", "collections", "sys.monitoring", "sys"}


def test_split_name():
    assert split_name("len", MODULES) == ("builtins", "len")
    assert split_name("str.split", MODULES) == ("builtins", "str.split")
    assert split_name("os.path.join", MODULES) == ("os.path", "join")
    assert split_name("os.fspath", MODULES) == ("os", "fspath")
    assert split_name("xml.etree.ElementTree.Element.find", MODULES) == (
        "xml.etree.ElementTree",
        "Element.find",
    )
    assert split_name("sys.monitoring.events.BRANCH", MODULES) == ("sys.monitoring", "events.BRANCH")


def _div(html: str):
    return lxml.html.fragment_fromstring(html)


def test_admonitions():
    nodes = [
        _div('<div class="versionadded"><p><span class="versionmodified added">Added in version 3.2.</span></p></div>'),
        _div(
            '<div class="versionchanged"><p><span class="versionmodified changed">Changed in version 3.10: </span>'
            "Removed the <em>loop</em> parameter.</p></div>"
        ),
        _div(
            '<div class="versionchanged soft-deprecated"><p><span class="versionmodified soft-deprecated">'
            '<a href="#">Soft deprecated</a> since version 3.14: </span>Use x.</p></div>'
        ),
        _div(
            '<div class="deprecated-removed"><p><span class="versionmodified deprecated">'
            "Deprecated since version 3.3, will be removed in version 3.16: </span>Use w.</p></div>"
        ),
        _div(
            '<div class="availability docutils container"><p><a href="#"><span>Availability</span></a>: '
            "Linux &gt;= 5.3, Android &gt;= API level 31, not WASI.</p></div>"
        ),
        _div('<div class="impl-detail compound"><p><strong>CPython implementation detail:</strong> x</p></div>'),
    ]
    info = docs_html.parse_admonitions(nodes)
    assert info["added"] == [{"version": "3.2", "text": ""}]
    assert info["changed"] == [
        {"version": "3.10", "text": "Removed the loop parameter."},
        {"version": "3.14", "text": "Soft deprecated. Use x."},
    ]
    assert info["deprecated"] == {"version": "3.3", "removedIn": "3.16", "text": "Use w."}
    assert info["availability"] == ["Linux >= 5.3", "Android >= API level 31", "not WASI"]
    assert info["implDetail"] is True


def test_pick_added_keeps_feature_notes_as_changes():
    added, extra = _pick_added(
        [
            {"version": "3.15", "text": "Added the module parameter."},
            {"version": "2.6", "text": ""},
        ]
    )
    assert added == "2.6"
    assert extra == [{"version": "3.15", "text": "Added the module parameter."}]


def test_source_statements():
    code = ">>> x = [\n...     1,\n... ]\n>>> x\n[1]\n>>> for i in x:\n...     print(i)\n...\n1"
    assert doctests.source_statements(code) == ["x = [\n    1,\n]", "x", "for i in x:\n    print(i)\n"]


def _index():
    syms = [
        ("collections/Counter", "collections", "Counter", "class", "library/collections.html"),
        ("collections/Counter.most_common", "collections", "Counter.most_common", "method", "library/collections.html"),
        ("collections/deque", "collections", "deque", "class", "library/collections.html"),
        ("collections/deque.append", "collections", "deque.append", "method", "library/collections.html"),
        ("json/dumps", "json", "dumps", "function", "library/json.html"),
        ("os/open", "os", "open", "function", "library/os.html"),
        ("builtins/len", "builtins", "len", "function", "builtins/functions.html"),
        ("builtins/str.split", "builtins", "str.split", "method", "builtins/stdtypes.html"),
        ("builtins/bytes.split", "builtins", "bytes.split", "method", "builtins/stdtypes.html"),
    ]
    return doctests.SymbolIndex.build(syms, {"collections", "json", "os", "builtins"})


def test_prose_resolution():
    idx = _index()
    page = "library/collections.html"
    code = ">>> from collections import Counter\n>>> c = Counter('abracadabra')\n>>> c.most_common(3)\n[('a', 5)]"
    assert doctests.called_symbols(code, idx, {"collections"}, page) == [
        "collections/Counter",
        "collections/Counter.most_common",
    ]
    # A list's append on an unknown receiver is not deque.append.
    assert doctests.called_symbols(">>> xs.append(1)", idx, {"collections"}, page) == []
    # Calls into modules not documented on the page are ignored.
    assert doctests.called_symbols(">>> import json\n>>> json.dumps(1)", idx, {"collections"}, page) == []
    assert doctests.called_symbols(">>> import json\n>>> json.dumps(1)", idx, {"json"}, "library/json.html") == [
        "json/dumps"
    ]
    # A bare open() is the builtin, not os.open.
    assert doctests.called_symbols(">>> open('f')", idx, {"os"}, "library/os.html") == []
    # Literal receivers resolve on the builtins pages; len lives on another page.
    stdtypes = "builtins/stdtypes.html"
    assert doctests.called_symbols(">>> len('a b'.split())", idx, {"builtins"}, stdtypes) == ["builtins/str.split"]
    # Snippet code is only parsed, never run.
    assert doctests.called_symbols(">>> import os; os.system('exit 1')", idx, {"json"}, "library/json.html") == []


def test_attach_orders_block_before_prose():
    idx = _index()
    out = doctests.attach(
        [(["collections/Counter.most_common"], ">>> Counter('ab').most_common(1)", "u#block")],
        [
            (">>> c = Counter('ab')\n>>> c.most_common()", "library/collections.html", "u#prose", {"collections"}, "collections"),
            (">>> print(1)", "library/collections.html", "u#other", {"collections"}, "collections"),
        ],
        idx,
    )
    assert [s["from"] for s in out.by_symbol["collections/Counter.most_common"]] == ["block", "prose"]
    assert out.unattached == {"collections": [{"code": ">>> print(1)", "url": "u#other"}]}
