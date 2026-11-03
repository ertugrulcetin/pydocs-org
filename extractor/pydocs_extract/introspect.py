"""Run introspect_worker.py once per module, in parallel, with a timeout."""

import json
import os
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

from . import config

WORKER = Path(__file__).with_name("introspect_worker.py")


@dataclass
class ModuleResult:
    module: str
    status: str  # "ok", "skipped", "failed"
    reason: str | None = None
    doc: str | None = None
    symbols: dict[str, dict] = field(default_factory=dict)


def _env() -> dict[str, str]:
    # A clean environment: no PYTHON* variables from the caller, no display,
    # and a fixed hash seed so reprs of sets in signatures are stable.
    env = {
        "PATH": "/usr/bin:/bin",
        "HOME": tempfile.gettempdir(),
        "LANG": "en_US.UTF-8",
        "TERM": "dumb",
        "PYTHONHASHSEED": "0",
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONIOENCODING": "utf-8",
    }
    return env


def introspect_module(module: str, symbols: list[tuple[str, str]], python: str) -> ModuleResult:
    reason = config.skip_reason(module)
    if reason:
        return ModuleResult(module, "skipped", reason)
    with tempfile.TemporaryDirectory(prefix="pydocs-introspect-") as tmp:
        req = Path(tmp) / "request.json"
        out = Path(tmp) / "result.json"
        req.write_text(
            json.dumps({"module": module, "symbols": symbols, "skip": sorted(config.SKIP_IMPORT)}),
            encoding="utf-8",
        )
        try:
            proc = subprocess.run(
                # -s: no user site-packages. -P: don't put the worker's folder
                # on sys.path. The env above replaces -E.
                [python, "-s", "-P", str(WORKER), str(req), str(out)],
                cwd=tmp,
                env=_env(),
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=config.INTROSPECT_TIMEOUT_S,
            )
        except subprocess.TimeoutExpired:
            return ModuleResult(module, "failed", f"timeout after {config.INTROSPECT_TIMEOUT_S}s")
        if not out.exists():
            tail = proc.stderr.decode("utf-8", "replace").strip().splitlines()[-1:] or [""]
            return ModuleResult(module, "failed", f"worker exited {proc.returncode}: {tail[0]}")
        data = json.loads(out.read_text(encoding="utf-8"))
    if not data["ok"]:
        return ModuleResult(module, "failed", data["error"])
    return ModuleResult(module, "ok", None, data["doc"], data["symbols"])


def introspect_all(
    wanted: dict[str, list[tuple[str, str]]], jobs: int | None = None
) -> dict[str, ModuleResult]:
    python = sys.executable
    jobs = jobs or os.cpu_count() or 4
    # Biggest modules first so the slow ones don't start last.
    order = sorted(wanted, key=lambda m: -len(wanted[m]))
    with ThreadPoolExecutor(max_workers=jobs) as pool:
        futures = {m: pool.submit(introspect_module, m, wanted[m], python) for m in order}
        return {m: futures[m].result() for m in sorted(wanted)}
