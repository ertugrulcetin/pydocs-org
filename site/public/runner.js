// PyDocs example runner (PLAN.md Phase 8). Loaded only inside
// <iframe sandbox="allow-scripts" src="/runner">: the frame has an opaque
// origin, so code running here gets no cookies and can't call the PyDocs API
// as the visitor (any request it makes is cross-site and fails the API's
// Origin check). Python runs in a Web Worker, so a runaway loop can't freeze
// the page; the parent page removes the frame to stop it.
(function () {
  'use strict';

  // REPL-style runner: shows the value of each top-level expression, like the
  // interactive interpreter. Doctest-style snippets (>>> / ...) are run from
  // their prompt lines; the expected-output lines are ignored.
  var PY_SETUP = [
    'import ast, contextlib, io, json, re, sys, traceback',
    '_PROMPT = re.compile(r"^(>>>|\\.\\.\\.)(?: |$)(.*)$")',
    'def _pydocs_source(src):',
    '    lines = src.splitlines()',
    '    if not any(l.startswith(">>>") for l in lines):',
    '        return src',
    '    return "\\n".join(m.group(2) for l in lines if (m := _PROMPT.match(l)))',
    'def _pydocs_prelude(ns, module, name):',
    '    # Like ClojureDocs, where clojure.core is always in scope: run the example',
    '    # with its own module and symbol imported (never import *).',
    '    done = []',
    '    if not re.fullmatch(r"[A-Za-z_][\\w.]*", module or "") or module == "builtins":',
    '        return done',
    '    for stmt in (f"import {module}", f"from {module} import {name}" if re.fullmatch(r"[A-Za-z_]\\w*", name or "") else None):',
    '        if stmt:',
    '            try:',
    '                exec(stmt, ns)',
    '                done.append(stmt)',
    '            except BaseException:',
    '                pass',
    '    return done',
    'def _pydocs_run(src, module="", name=""):',
    '    out = io.StringIO()',
    '    ns = {"__name__": "__main__"}',
    '    prelude = _pydocs_prelude(ns, module, name)',
    '    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):',
    '        try:',
    '            tree = ast.parse(_pydocs_source(src), "<example>")',
    '            for node in tree.body:',
    '                if isinstance(node, ast.Expr):',
    '                    value = eval(compile(ast.Expression(node.value), "<example>", "eval"), ns)',
    '                    if value is not None:',
    '                        print(repr(value))',
    '                else:',
    '                    exec(compile(ast.Module([node], []), "<example>", "exec"), ns)',
    '        except SystemExit:',
    '            pass',
    '        except SyntaxError as e:',
    '            print("".join(traceback.format_exception_only(e)), end="")',
    '        except BaseException as e:',
    '            # Skip this helper\'s own frame in the traceback.',
    '            traceback.print_exception(type(e), e, e.__traceback__.tb_next)',
    '    return json.dumps({"output": out.getvalue(), "version": sys.version.split()[0], "prelude": prelude})',
  ].join('\n');

  var WORKER_SRC =
    'var PY_SETUP = ' + JSON.stringify(PY_SETUP) + ';\n' +
    'var ready = null;\n' +
    'self.onmessage = async function (e) {\n' +
    '  var id = e.data.id, code = e.data.code, indexURL = e.data.indexURL, module = e.data.module || "", name = e.data.name || "";\n' +
    '  try {\n' +
    '    if (!ready) ready = (async function () {\n' +
    '      importScripts(indexURL + "pyodide.js");\n' +
    '      var py = await loadPyodide({ indexURL: indexURL });\n' +
    '      py.setStdin({ error: true });\n' +
    '      py.runPython(PY_SETUP);\n' +
    '      return py;\n' +
    '    })();\n' +
    '    var py = await ready;\n' +
    '    self.postMessage({ id: id, phase: "running" });\n' +
    // Some stdlib modules (sqlite3, lzma, ...) are separate Pyodide packages:
    // load what the example and its pre-imported module need.
    '    var src = py.globals.get("_pydocs_source")(code);\n' +
    '    try { await py.loadPackagesFromImports((/^[A-Za-z_][\\w.]*$/.test(module) ? "import " + module + "\\n" : "") + src); } catch (_) {}\n' +
    '    var result = JSON.parse(py.globals.get("_pydocs_run")(code, module, name));\n' +
    '    self.postMessage({ id: id, output: result.output, version: result.version, prelude: result.prelude });\n' +
    '  } catch (err) {\n' +
    '    ready = null;\n' +
    '    self.postMessage({ id: id, error: String((err && err.message) || err) });\n' +
    '  }\n' +
    '};\n';

  var worker = null;
  function startWorker() {
    var url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
    // A classic worker: module workers from blob: URLs are refused in opaque
    // (sandboxed) origins, classic ones are not.
    worker = new Worker(url);
    worker.onmessage = function (e) {
      var d = e.data;
      if (d.phase) window.parent.postMessage({ type: 'phase', id: d.id, phase: d.phase }, '*');
      else window.parent.postMessage({ type: 'result', id: d.id, output: d.output, error: d.error, version: d.version, prelude: d.prelude }, '*');
    };
    worker.onerror = function (e) {
      window.parent.postMessage({ type: 'result', id: -1, error: 'The Python runner failed to start: ' + (e.message || 'unknown error') }, '*');
    };
  }

  window.addEventListener('message', function (e) {
    if (e.source !== window.parent) return; // only the page that embeds us
    var m = e.data;
    if (!m || m.type !== 'run' || typeof m.code !== 'string' || typeof m.indexURL !== 'string') return;
    if (!worker) startWorker();
    worker.postMessage({ id: m.id, code: m.code, indexURL: m.indexURL, module: String(m.module || ''), name: String(m.name || '') });
  });

  window.parent.postMessage({ type: 'ready' }, '*');
})();
