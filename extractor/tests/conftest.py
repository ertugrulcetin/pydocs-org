import pytest

from pydocs_extract.build import build
from pydocs_extract.download import ensure_inputs

# ~30 well-known symbols. Each one covers a case the extractor must handle.
SNAPSHOT_IDS = [
    "builtins/len",  # CPython implementation detail
    "builtins/str.split",  # method; doctests inside its own <dl>
    "builtins/range",  # two signatures (two <dt>s)
    "builtins/dict.fromkeys",  # classmethod
    "builtins/str.maketrans",  # staticmethod, two signatures
    "builtins/list.append",  # anchor is a <span> inside the shared sequence.append block
    "builtins/ExceptionGroup",  # empty <dd>; text shared with the next directive
    "builtins/codeobject.co_argcount",  # pseudo-class; text in the next table cell
    "os.path/join",  # frozen module; source link still points to Lib/posixpath.py
    "os/fork",  # availability + changed
    "os/O_RDONLY",  # constant: no docstring, docs text instead
    "collections/Counter",  # class
    "collections/Counter.most_common",  # doctests from its block and from prose
    "json/dumps",  # doctests only from module prose
    "itertools/groupby",
    "functools/lru_cache",  # decorator, added + changed
    "functools/cached_property",  # decorator documented as a class-like object
    "contextlib/contextmanager",  # decorator documented without arguments
    "re/sub",  # deprecated (positional args) + many changed
    "pathlib/Path.read_text",  # added + changed
    "pathlib/PurePath.name",  # property docstring + source
    "datetime/datetime.strptime",  # classmethod; changed in 3.15
    "asyncio/gather",  # "awaitable" in the docs -> isAsync; deprecated
    "asyncio/sleep",  # coroutine function -> isAsync
    "asyncio/loop.call_soon",  # pseudo-class "loop": no parent, no introspection
    "winreg/OpenKey",  # Windows-only: docs-text fallback
    "msvcrt/getch",  # Windows-only: docs-text fallback
    "tkinter/Canvas.lower",  # skipped module; alias anchor on a <dl>
    "typing/Optional",  # special form with an instance docstring
    "annotationlib/Format.VALUE",  # "= 1" value in the signature
    "sys/maxsize",  # data
    "sys.monitoring/use_tool_id",  # module that is an attribute of sys
    "math/comb",  # anchor on a table paragraph (moved to math.integer)
    "mimetypes/guess_type",  # soft deprecated (kept in "changed")
]

SNAPSHOT_MODULES = sorted({i.split("/", 1)[0] for i in SNAPSHOT_IDS})


@pytest.fixture(scope="session")
def inputs():
    return ensure_inputs("archive")


@pytest.fixture(scope="session")
def result(inputs):
    return build(inputs, only=set(SNAPSHOT_MODULES))


@pytest.fixture(scope="session")
def records(result):
    return {r["id"]: r for recs in result.symbols.values() for r in recs}
