"""Pinned inputs, paths, and the import skip list."""

from pathlib import Path

PYTHON_VERSION = (3, 15, 2)
PYTHON_VERSION_STR = "3.15.2"
DOCS_TAG = "v3.15.2"

DOCS_BASE_URL = "https://docs.python.org/3.15/"
SOURCE_BASE_URL = f"https://github.com/python/cpython/blob/{DOCS_TAG}/"

# The live inventory tracks the 3.15 branch, so it can list objects documented
# after 3.15.2 was tagged. The archive ships the inventory of the pinned build,
# which matches the HTML we parse. `--inventory live` switches to the live one.
INVENTORY_URL = "https://docs.python.org/3.15/objects.inv"
DOCS_ARCHIVE_URL = (
    "https://www.python.org/ftp/python/doc/3.15.2/python-3.15.2-docs-html.tar.bz2"
)
DOCS_ARCHIVE_ROOT = "python-3.15.2-docs-html"

EXTRACTOR_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = EXTRACTOR_DIR.parent
CACHE_DIR = EXTRACTOR_DIR / ".cache"
OUT_DIR = REPO_ROOT / "data" / "py-3.15"

# Modules that are never imported for introspection. They get docs-text only.
# A prefix entry ("tkinter") also covers its submodules ("tkinter.ttk").
SKIP_IMPORT: dict[str, str] = {
    "antigravity": "opens a web browser on import",
    "this": "prints the Zen of Python on import",
    "__main__": "would introspect the worker script itself",
    "idlelib": "GUI application package",
    "tkinter": "GUI toolkit (loads Tk)",
    "_tkinter": "GUI toolkit (loads Tk)",
    "turtle": "GUI toolkit (imports tkinter)",
    "turtledemo": "GUI demo package (imports tkinter)",
    "sitecustomize": "would import the local site customization hook",
    "usercustomize": "would import the local user customization hook",
}

INTROSPECT_TIMEOUT_S = 120


def skip_reason(module: str) -> str | None:
    for name, reason in SKIP_IMPORT.items():
        if module == name or module.startswith(name + "."):
            return reason
    return None
