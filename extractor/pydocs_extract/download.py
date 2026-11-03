"""Download and cache the pinned inputs.

Everything downloaded is untrusted data. It is only parsed, never executed.
Each input lives in its own cache directory.
"""

import hashlib
import shutil
import tarfile
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from . import config


@dataclass(frozen=True)
class Inputs:
    docs_root: Path  # extracted HTML tree
    inventory: Path  # objects.inv actually used
    inventory_source: str  # "archive" or "live"
    inventory_url: str
    inventory_sha256: str
    archive_url: str
    archive_sha256: str


def _fetch(url: str, dest: Path) -> Path:
    if dest.exists():
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    req = urllib.request.Request(url, headers={"User-Agent": "pydocs-extract"})
    with urllib.request.urlopen(req, timeout=120) as resp, tmp.open("wb") as out:
        shutil.copyfileobj(resp, out)
    tmp.replace(dest)
    return dest


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _extract(archive: Path, dest_parent: Path) -> Path:
    root = dest_parent / config.DOCS_ARCHIVE_ROOT
    marker = dest_parent / ".complete"
    if marker.exists() and root.is_dir():
        return root
    if dest_parent.exists():
        shutil.rmtree(dest_parent)
    dest_parent.mkdir(parents=True)
    with tarfile.open(archive, "r:bz2") as tar:
        # The "data" filter rejects absolute paths, "..", links out of the
        # tree, and device files.
        tar.extractall(dest_parent, filter="data")
    if not root.is_dir():
        raise RuntimeError(f"archive has no {config.DOCS_ARCHIVE_ROOT}/ folder")
    marker.write_text("ok\n")
    return root


def ensure_inputs(inventory_source: str = "archive") -> Inputs:
    cache = config.CACHE_DIR
    archive = _fetch(
        config.DOCS_ARCHIVE_URL,
        cache / "archive" / config.DOCS_ARCHIVE_URL.rsplit("/", 1)[1],
    )
    docs_root = _extract(archive, cache / "docs-html")
    if inventory_source == "live":
        inventory = _fetch(config.INVENTORY_URL, cache / "inventory" / "objects.inv")
        inventory_url = config.INVENTORY_URL
    elif inventory_source == "archive":
        inventory = docs_root / "objects.inv"
        inventory_url = config.DOCS_ARCHIVE_URL + "#objects.inv"
    else:
        raise ValueError(f"unknown inventory source {inventory_source!r}")
    return Inputs(
        docs_root=docs_root,
        inventory=inventory,
        inventory_source=inventory_source,
        inventory_url=inventory_url,
        inventory_sha256=sha256(inventory),
        archive_url=config.DOCS_ARCHIVE_URL,
        archive_sha256=sha256(archive),
    )
