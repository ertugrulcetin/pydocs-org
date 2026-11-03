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
    'import ast, contextlib, inspect, io, json, re, sys, traceback',
    'from pyodide.ffi import run_sync',
    '# Top-level await, as in the asyncio REPL (python -m asyncio).',
    '_FLAGS = ast.PyCF_ALLOW_TOP_LEVEL_AWAIT',
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
    '                expr = isinstance(node, ast.Expr)',
    '                tree1 = ast.Expression(node.value) if expr else ast.Module([node], [])',
    '                code = compile(tree1, "<example>", "eval" if expr else "exec", flags=_FLAGS)',
    '                value = eval(code, ns)',
    '                if code.co_flags & inspect.CO_COROUTINE:',
    '                    # Needs stack switching (JSPI): the worker starts this',
    '                    # function with callPromising().',
    '                    value = run_sync(value)',
    '                if expr and value is not None:',
    '                    print(repr(value))',
    '        except SystemExit:',
    '            pass',
    '        except SyntaxError as e:',
    '            print("".join(traceback.format_exception_only(e)), end="")',
    '        except BaseException as e:',
    '            # Skip this helper\'s own frame in the traceback.',
    '            traceback.print_exception(type(e), e, e.__traceback__.tb_next)',
    '    return json.dumps({"output": out.getvalue(), "version": sys.version.split()[0], "prelude": prelude})',
  ].join('\n');

  // Runs inside the Web Worker. It is serialized with toString(), so it can use
  // nothing from this file except PY_SETUP, which is defined in front of it.
  function workerMain() {
    // Pyodide 314 refuses to start in a classic worker, which it detects by
    // loading a data: URL with importScripts. The /runner CSP blocks data:
    // scripts, so production passed that check by accident; block them here
    // too, so the runner also works where the CSP isn't applied (astro preview).
    // A classic worker is fine: pyodide.asm.mjs is loaded with import().
    var importScriptsOrig = self.importScripts;
    self.importScripts = function (url) {
      if (/^\s*data:/i.test(String(url))) throw new TypeError('data: scripts are not allowed here');
      return importScriptsOrig.apply(self, arguments);
    };
    var ready = null;
    var files = null; // runtime files handed over by the page: name -> ArrayBuffer

    async function start(indexURL) {
      var options = { indexURL: indexURL, packageBaseUrl: indexURL };
      var f = files;
      var netFetch = self.fetch;
      if (f) {
        // Start from the bytes the page handed over (it keeps them in Cache
        // Storage): nothing is downloaded. This frame's opaque origin has no
        // storage, and Chrome doesn't reuse its HTTP cache across page loads.
        var script = function (name) {
          return URL.createObjectURL(new Blob([f[name]], { type: 'text/javascript' }));
        };
        importScripts(script('pyodide.js'));
        options.createPyodideModule = (await import(script('pyodide.asm.mjs'))).default;
        options.lockFileContents = JSON.parse(new TextDecoder().decode(f['pyodide-lock.json']));
        // Pyodide fetches these two itself: answer from memory.
        var types = { 'pyodide.asm.wasm': 'application/wasm', 'python_stdlib.zip': 'application/zip' };
        self.fetch = function (input, init) {
          var url = input instanceof Request ? input.url : String(input);
          var name = url.indexOf(indexURL) === 0 ? url.slice(indexURL.length) : '';
          if (types[name] && f[name]) return Promise.resolve(new Response(f[name], { headers: { 'Content-Type': types[name] } }));
          return netFetch.call(self, input, init);
        };
      } else {
        importScripts(indexURL + 'pyodide.js');
      }
      var py;
      try {
        py = await loadPyodide(options);
      } finally {
        self.fetch = netFetch;
      }
      files = null; // loaded: free the copies
      py.setStdin({ error: true });
      py.runPython(PY_SETUP);
      return py;
    }

    // One run at a time: a run that waits (asyncio.sleep) must not let the
    // next one start and mix their output.
    var queue = Promise.resolve();
    self.onmessage = function (e) {
      var d = e.data;
      if (d.files) files = d.files;
      queue = queue.then(function () {
        return handle(d);
      });
    };

    async function handle(d) {
      try {
        if (!ready) ready = start(d.indexURL);
        var py = await ready;
        self.postMessage({ id: d.id, phase: 'running' });
        // callPromising enables stack switching (JSPI), so Python can block on
        // a coroutine: asyncio.run() and top-level await need it.
        var run = py.globals.get('_pydocs_run');
        var out;
        try {
          out = typeof WebAssembly.Suspending === 'function' && typeof run.callPromising === 'function'
            ? await run.callPromising(d.code, d.module, d.name)
            : run(d.code, d.module, d.name);
        } finally {
          run.destroy();
        }
        var result = JSON.parse(out);
        self.postMessage({ id: d.id, output: result.output, version: result.version, prelude: result.prelude });
      } catch (err) {
        ready = null;
        self.postMessage({ id: d.id, error: String((err && err.message) || err) });
      }
    }
  }
  var WORKER_SRC = 'var PY_SETUP = ' + JSON.stringify(PY_SETUP) + ';\n(' + workerMain.toString() + ')();\n';

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
    // Runtime files (first run only): pass them on to the worker without copying.
    var files = null;
    var transfer = [];
    if (m.files && typeof m.files === 'object') {
      files = {};
      Object.keys(m.files).forEach(function (k) {
        if (m.files[k] instanceof ArrayBuffer) {
          files[k] = m.files[k];
          transfer.push(m.files[k]);
        }
      });
    }
    var message = { id: m.id, code: m.code, indexURL: m.indexURL, module: String(m.module || ''), name: String(m.name || ''), files: files };
    worker.postMessage(message, transfer);
  });

  window.parent.postMessage({ type: 'ready' }, '*');
})();
