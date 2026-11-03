"""CLI: build data/py-3.15/ from the pinned Python docs and introspection.

    uv run pydocs-extract                    # full run
    uv run pydocs-extract --only json,re     # a few modules, to a scratch dir
"""

import argparse
import json
import os
import shutil
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

from . import config
from .build import Result, build
from .download import ensure_inputs


def _dump(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def write_lines_array(path: Path, items: list) -> None:
    """A JSON array with one compact item per line: small, and diffs well."""
    body = ",\n".join(_dump(i) for i in items)
    path.write_text(f"[\n{body}\n]\n" if items else "[]\n", encoding="utf-8")


def write_lines_object(path: Path, obj: dict) -> None:
    body = ",\n".join(f"{_dump(k)}:{_dump(v)}" for k, v in obj.items())
    path.write_text(f"{{\n{body}\n}}\n" if obj else "{}\n", encoding="utf-8")


def write_doctests(path: Path, d: dict) -> None:
    syms = ",\n".join(f"{_dump(k)}:{_dump(v)}" for k, v in d["symbols"].items())
    una = ",\n".join(_dump(u) for u in d["unattached"])
    path.write_text(
        '{"symbols":{' + (f"\n{syms}\n" if syms else "") + '},\n"unattached":['
        + (f"\n{una}\n" if una else "") + "]}\n",
        encoding="utf-8",
    )


def generated_at() -> str:
    epoch = os.environ.get("SOURCE_DATE_EPOCH")
    ts = datetime.fromtimestamp(int(epoch), UTC) if epoch else datetime.now(UTC)
    return ts.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def write_output(result: Result, inputs, out: Path) -> dict:
    # The output dir is replaced as a whole. Never delete a folder we did
    # not write.
    if out.exists() and any(out.iterdir()) and not (out / "meta.json").is_file():
        raise SystemExit(f"refusing to replace {out}: not empty and has no meta.json")
    tmp = out.with_name(out.name + ".tmp")
    if tmp.exists():
        shutil.rmtree(tmp)
    (tmp / "symbols").mkdir(parents=True)
    (tmp / "doctests").mkdir()
    for module, records in result.symbols.items():
        write_lines_array(tmp / "symbols" / f"{module}.json", records)
    for module, d in result.doctests.items():
        write_doctests(tmp / "doctests" / f"{module}.json", d)
    write_lines_array(tmp / "modules.json", result.modules)
    write_lines_array(tmp / "chapters.json", result.chapters)
    counts = result.stats["counts"]
    meta = {
        "python": config.PYTHON_VERSION_STR,
        "docsTag": config.DOCS_TAG,
        "generatedAt": generated_at(),
        "counts": {
            "symbols": result.stats["symbols"],
            "modules": result.stats["modules"],
            "byKind": counts.get("kind", {}),
            "symbolsWithDoctest": counts.get("doctests", {}).get("symbolsWithDoctest", 0),
        },
        "docsBaseUrl": config.DOCS_BASE_URL,
        "sourceBaseUrl": config.SOURCE_BASE_URL,
        "sources": {
            "docsArchive": {"url": inputs.archive_url, "sha256": inputs.archive_sha256},
            "inventory": {
                "from": inputs.inventory_source,
                "url": inputs.inventory_url,
                "sha256": inputs.inventory_sha256,
            },
        },
        "introspectedOn": sys.platform,
    }
    (tmp / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    (tmp / "stats.json").write_text(
        json.dumps(result.stats, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )
    if out.exists():
        shutil.rmtree(out)
    tmp.rename(out)
    return meta


def dir_size(path: Path) -> tuple[int, int]:
    files = [p for p in path.rglob("*") if p.is_file()]
    return len(files), sum(p.stat().st_size for p in files)


def print_report(result: Result, out: Path, elapsed: float) -> None:
    s = result.stats
    c = s["counts"]
    n_files, size = dir_size(out)
    print(f"Python {s['python']} on {s['platform']}; inventory from {s['inventorySource']}")
    print(f"symbols: {s['symbols']}  modules: {s['modules']}")
    print("by kind:", ", ".join(f"{k} {v}" for k, v in sorted(c["kind"].items(), key=lambda x: -x[1])))
    for key in ("modules", "introspection", "doc", "signature", "docsBlock", "fields", "doctests"):
        if key in c:
            print(f"{key}:", ", ".join(f"{k} {v}" for k, v in c[key].items()))
    for key, items in s["lists"].items():
        if key.startswith("modules."):
            print(f"{key} ({len(items)}):")
            for i in items:
                print(f"  {i}")
        else:
            print(f"{key}: {len(items)}")
    print(f"output: {out} ({n_files} files, {size / 1e6:.2f} MB)")
    print("timings:", ", ".join(f"{k} {v:.1f}s" for k, v in result.timings.items()), f"total {elapsed:.1f}s")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="pydocs-extract", description=__doc__)
    ap.add_argument("--out", type=Path, default=None, help=f"output dir (default {config.OUT_DIR})")
    ap.add_argument("--only", default=None, help="comma-separated modules (needs --out)")
    ap.add_argument(
        "--inventory",
        choices=("archive", "live"),
        default="archive",
        help="objects.inv from the pinned 3.15.2 archive (default) or docs.python.org/3.15",
    )
    ap.add_argument("--jobs", type=int, default=None, help="parallel introspection workers")
    args = ap.parse_args(argv)

    if sys.version_info[:3] != config.PYTHON_VERSION:
        print(f"error: needs Python {config.PYTHON_VERSION_STR}, running {sys.version.split()[0]}", file=sys.stderr)
        return 2
    only = {m.strip() for m in args.only.split(",") if m.strip()} if args.only else None
    if only and args.out is None:
        print("error: --only writes partial data; pass --out to a scratch dir", file=sys.stderr)
        return 2
    out = (args.out or config.OUT_DIR).resolve()

    t0 = time.monotonic()
    inputs = ensure_inputs(args.inventory)
    result = build(inputs, only=only, jobs=args.jobs)
    write_output(result, inputs, out)
    print_report(result, out, time.monotonic() - t0)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
