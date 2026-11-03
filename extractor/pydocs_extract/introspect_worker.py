"""Introspect one stdlib module. Runs in its own interpreter process.

Usage: python -s -P introspect_worker.py REQUEST.json RESULT.json

REQUEST: {"module": "json", "symbols": [["dumps", "function"], ...],
          "skip": ["tkinter", ...]}
RESULT:  {"module": ..., "ok": bool, "error": str|null, "doc": str|null,
          "symbols": {qualname: {...}}}

This file only uses the standard library and must not import pydocs_extract,
so nothing from the project can shadow a stdlib module.
"""

import contextlib
import functools
import importlib
import inspect
import io
import json
import os
import re
import sys
import sysconfig
import types

STDLIB = os.path.realpath(sysconfig.get_path("stdlib"))
SKIP_DIRS = ("site-packages", "lib-dynload")
_MISSING = object()


def import_module(name):
    try:
        return importlib.import_module(name)
    except ModuleNotFoundError:
        # Documented "modules" that are attributes of a real module,
        # e.g. sys.monitoring.
        parts = name.split(".")
        for k in range(len(parts) - 1, 0, -1):
            try:
                obj = importlib.import_module(".".join(parts[:k]))
            except ImportError:
                continue
            for p in parts[k:]:
                obj = getattr(obj, p, _MISSING)
                if obj is _MISSING:
                    break
            else:
                if isinstance(obj, types.ModuleType):
                    return obj
            break
        raise


SKIP = ()


def skipped(name):
    return any(name == s or name.startswith(s + ".") for s in SKIP)


def resolve(module, qualname):
    """Return (obj, owner, static) or None. `static` is the raw attribute."""
    obj, owner, static = module, None, None
    for part in qualname.split("."):
        owner = obj
        if isinstance(owner, types.ModuleType) and not hasattr(owner, part):
            # A submodule the docs list under its package, e.g.
            # ctypes.util.find_library documented in the ctypes module.
            sub = f"{owner.__name__}.{part}"
            if not skipped(sub):
                try:
                    importlib.import_module(sub)
                except Exception:
                    pass
        try:
            static = inspect.getattr_static(owner, part)
        except AttributeError:
            static = _MISSING
        try:
            obj = getattr(owner, part)
        except Exception:
            if static is _MISSING:
                return None
            obj = static
    return obj, owner, static


def clean_doc(doc):
    if not isinstance(doc, str):
        return None
    doc = inspect.cleandoc(doc).strip()
    return doc or None


DESCRIPTORS = (property, functools.cached_property, types.GetSetDescriptorType, types.MemberDescriptorType)


def own_doc(obj, static):
    """The docstring that belongs to this object, never one inherited from the
    type of a plain value (an int constant must not get int's docstring)."""
    if inspect.ismodule(obj):
        return clean_doc(obj.__doc__)
    if inspect.isclass(obj):
        return clean_doc(obj.__dict__.get("__doc__"))
    if isinstance(static, DESCRIPTORS):
        return clean_doc(static.__doc__)
    if inspect.isroutine(obj) or isinstance(obj, (classmethod, staticmethod)):
        return clean_doc(inspect.getdoc(obj))
    # A plain value: only keep a docstring set on the instance itself
    # (typing special forms do this), never the docstring of its type.
    doc = getattr(obj, "__doc__", None)
    if isinstance(doc, str) and doc != getattr(type(obj), "__doc__", None):
        return clean_doc(doc)
    return None


def source_of(obj, static):
    target = obj
    if isinstance(static, property):
        target = static.fget
    elif isinstance(static, functools.cached_property):
        target = static.func
    elif isinstance(static, (classmethod, staticmethod)):
        target = static.__func__
    if not (inspect.isclass(target) or inspect.isfunction(target) or inspect.ismethod(target)):
        return None
    try:
        target = inspect.unwrap(target)
        path = inspect.getsourcefile(target)
        if path and path.startswith("<frozen ") and path.endswith(">"):
            # Startup modules (os, posixpath, codecs, ...) are frozen; their
            # source still ships in Lib/.
            path = getattr(sys.modules.get(path[len("<frozen "):-1]), "__file__", None)
        if not path:
            return None
        path = os.path.realpath(path)
        if not path.startswith(STDLIB + os.sep) or any(d in path for d in SKIP_DIRS):
            return None
        _, line = inspect.getsourcelines(target)
    except (TypeError, OSError, ValueError):
        return None
    rel = os.path.relpath(path, STDLIB).replace(os.sep, "/")
    return {"path": "Lib/" + rel, "line": max(line, 1)}


_ADDR = re.compile(r" at 0x[0-9a-fA-F]+>")


def signature_of(obj, owner, static, qualname):
    if not callable(obj):
        return None
    try:
        sig = inspect.signature(obj)
    except (TypeError, ValueError, RuntimeError):
        return None
    params = list(sig.parameters.values())
    # Methods looked up on the class are unbound; show them as called on an
    # instance, without self.
    if (
        inspect.isclass(owner)
        and not inspect.isclass(obj)
        and method_kind(static) is None
        and not isinstance(static, staticmethod)
        and params
        and params[0].name == "self"
    ):
        sig = sig.replace(parameters=params[1:])
    return _ADDR.sub(">", f"{qualname}{sig}")


def method_kind(static):
    if isinstance(static, (classmethod, types.ClassMethodDescriptorType)):
        return "classmethod"
    if isinstance(static, staticmethod):
        return "staticmethod"
    return None


def is_async(obj):
    try:
        target = inspect.unwrap(obj) if callable(obj) else obj
    except ValueError:
        target = obj
    for o in (obj, target):
        if inspect.iscoroutinefunction(o) or inspect.isasyncgenfunction(o):
            return True
    return False


def introspect(module, qualname):
    r = resolve(module, qualname)
    if r is None:
        return {"resolved": False}
    obj, owner, static = r
    out = {"resolved": True}
    for key, fn in (
        ("doc", lambda: own_doc(obj, static)),
        ("signature", lambda: signature_of(obj, owner, static, qualname)),
        ("source", lambda: source_of(obj, static)),
        ("methodKind", lambda: method_kind(static) if inspect.isclass(owner) else None),
        ("isAsync", lambda: is_async(obj)),
        ("callable", lambda: callable(obj)),
    ):
        try:
            out[key] = fn()
        except Exception as e:  # one bad attribute must not lose the module
            out[key] = None
            out.setdefault("errors", []).append(f"{key}: {type(e).__name__}: {e}")
    return out


def main():
    req_path, out_path = sys.argv[1], sys.argv[2]
    with open(req_path, encoding="utf-8") as f:
        req = json.load(f)
    global SKIP
    SKIP = tuple(req.get("skip", ()))
    result = {"module": req["module"], "ok": False, "error": None, "doc": None, "symbols": {}}
    sink = io.StringIO()
    try:
        # Keep import-time output away from our result.
        with contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
            module = import_module(req["module"])
            result["doc"] = clean_doc(module.__doc__)
            for qualname, _kind in req["symbols"]:
                result["symbols"][qualname] = introspect(module, qualname)
        result["ok"] = True
    except BaseException as e:  # ImportError, SystemExit, OSError on import ...
        result["error"] = f"{type(e).__name__}: {e}"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f)


if __name__ == "__main__":
    main()
