"""Snapshot tests on well-known symbols.

Regenerate after an intended change, then review the diff:

    UPDATE_SNAPSHOTS=1 uv run pytest tests/test_snapshots.py
"""

import json
import os
from pathlib import Path

import pytest

from pydocs_extract import config

from .conftest import SNAPSHOT_IDS

SNAPSHOT_DIR = Path(__file__).parent / "snapshots"
UPDATE = os.environ.get("UPDATE_SNAPSHOTS") == "1"


def snapshot_path(sid: str) -> Path:
    return SNAPSHOT_DIR / (sid.replace("/", "--") + ".json")


def actual(sid, records, result):
    module = sid.split("/", 1)[0]
    return {
        "symbol": records[sid],
        "doctests": result.doctests[module]["symbols"].get(sid, []),
    }


@pytest.mark.parametrize("sid", SNAPSHOT_IDS)
def test_symbol_snapshot(sid, records, result):
    assert sid in records, f"{sid} is not in the build output"
    got = actual(sid, records, result)
    path = snapshot_path(sid)
    if UPDATE or not path.exists():
        SNAPSHOT_DIR.mkdir(exist_ok=True)
        path.write_text(json.dumps(got, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        if not UPDATE:
            pytest.fail(f"wrote new snapshot {path.name}; review it and run again")
    assert got == json.loads(path.read_text(encoding="utf-8"))


@pytest.mark.parametrize("sid", SNAPSHOT_IDS)
def test_committed_data_matches_build(sid, records):
    """data/py-3.15 must be regenerated when the extractor output changes."""
    module = sid.split("/", 1)[0]
    path = config.OUT_DIR / "symbols" / f"{module}.json"
    if not path.exists():
        pytest.skip("data/py-3.15 not generated")
    committed = {r["id"]: r for r in json.loads(path.read_text(encoding="utf-8"))}
    assert committed.get(sid) == records[sid]
