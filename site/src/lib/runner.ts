// Runs example code with Pyodide in a sandboxed iframe (public/runner.js).
// The frame is created on the first run and reused; it is removed (which stops
// the Python worker) if a run takes too long.
//
// Runtime files (~13 MB): the sandboxed frame has an opaque origin, so it has
// no storage of its own, and Chrome doesn't reuse its HTTP cache across page
// loads (every reload downloaded everything again). So this page, which has a
// real origin, keeps the files in Cache Storage and hands the bytes to the
// frame on the first run; the worker starts Python without downloading.
export interface RunResult {
  output?: string;
  error?: string;
  /** Python version Pyodide runs, e.g. "3.14.2". */
  version?: string;
  /** Imports run before the example, e.g. ["import collections", "from collections import Counter"]. */
  prelude?: string[];
}

/** The symbol an example belongs to: its module and top-level name are imported first. */
export interface RunContext {
  module: string;
  name: string;
}

/** The files Python needs to start (site/integrations/pyodide.mjs copies them). */
const RUNTIME_FILES = ['pyodide.js', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json'] as const;
type RuntimeFiles = Record<string, ArrayBuffer>;
const CACHE_PREFIX = 'pydocs-pyodide:';

const LOAD_TIMEOUT_MS = 90_000; // the first run downloads ~13 MB
const START_TIMEOUT_MS = 30_000; // starting from files in memory takes ~2 s
const RUN_TIMEOUT_MS = 10_000;

let frame: HTMLIFrameElement | null = null;
let ready: Promise<void> | null = null;
let onMessage: ((e: MessageEvent) => void) | null = null;
let loaded = false;
let runtime: Promise<RuntimeFiles | null> | null = null;
let handedOver = false;
let seq = 0;
interface Pending {
  done: (r: RunResult) => void;
  /** Python has loaded and the code starts running now. */
  running: () => void;
}
const pending = new Map<number, Pending>();

/** True once Python has loaded in this page (later runs are fast). */
export const pythonLoaded = () => loaded;

/** Absolute URL of the self-hosted Pyodide directory, e.g. https://pydocs.org/pyodide/314.0.7/. */
const indexURL = () =>
  new URL(document.querySelector<HTMLMetaElement>('meta[name="pydocs:pyodide"]')?.content ?? '', location.origin).href;

/** One cache per Pyodide version, e.g. "pydocs-pyodide:/pyodide/314.0.7/". */
const cacheName = (url: string) => CACHE_PREFIX + new URL(url).pathname;

/** True if Python can start without downloading (all runtime files are stored). */
export async function runtimeStored(): Promise<boolean> {
  try {
    const url = indexURL();
    if (!(await caches.has(cacheName(url)))) return false;
    const cache = await caches.open(cacheName(url));
    return (await Promise.all(RUNTIME_FILES.map((f) => cache.match(url + f)))).every(Boolean);
  } catch {
    return false;
  }
}

/** The runtime files from Cache Storage, downloading (and storing) any that are missing. */
async function loadRuntime(url: string): Promise<RuntimeFiles | null> {
  let cache: Cache | null = null;
  try {
    const name = cacheName(url);
    cache = await caches.open(name);
    // Drop the files of older Pyodide versions.
    for (const k of await caches.keys()) if (k.startsWith(CACHE_PREFIX) && k !== name) void caches.delete(k);
  } catch {
    // No Cache Storage (some private modes): download every time.
  }
  try {
    const entries = await Promise.all(
      RUNTIME_FILES.map(async (f) => {
        let res = await cache?.match(url + f).catch(() => undefined);
        if (!res) {
          res = await fetch(url + f);
          if (!res.ok) throw new Error(`${f}: HTTP ${res.status}`);
          // Storage full: still runs, just not stored.
          if (cache) await cache.put(url + f, res.clone()).catch(() => {});
        }
        return [f, await res.arrayBuffer()] as const;
      }),
    );
    return Object.fromEntries(entries);
  } catch {
    return null; // the worker then downloads the files itself
  }
}

function reset(reason: string): void {
  if (onMessage) removeEventListener('message', onMessage);
  frame?.remove();
  frame = null;
  ready = null;
  onMessage = null;
  loaded = false;
  runtime = null; // the files were transferred to the old frame
  handedOver = false;
  for (const p of pending.values()) p.done({ error: reason });
  pending.clear();
}

function ensureFrame(): Promise<void> {
  if (ready) return ready;
  const f = document.createElement('iframe');
  f.setAttribute('sandbox', 'allow-scripts'); // opaque origin: no cookies, no access to this page
  f.title = 'Python example runner';
  f.hidden = true;
  f.src = '/runner';
  frame = f;
  ready = new Promise<void>((resolve) => {
    onMessage = (e: MessageEvent) => {
      if (e.source !== f.contentWindow) return;
      const m = e.data as { type?: string; id?: number } & RunResult;
      if (m?.type === 'ready') resolve();
      else if (m?.type === 'phase') pending.get(m.id!)?.running();
      else if (m?.type === 'result') {
        if (m.id === -1) return reset(m.error ?? 'The Python runner failed.');
        const p = pending.get(m.id!);
        pending.delete(m.id!);
        p?.done(m);
      }
    };
    addEventListener('message', onMessage);
  });
  document.body.appendChild(f);
  return ready;
}

/**
 * Runs `code` and resolves with its output (never rejects). The first run in
 * a page also loads Python; `onRunning` fires when the code itself starts, and
 * the 10-second run limit starts then, not while Python loads.
 */
export async function runPython(code: string, onRunning?: () => void, context?: RunContext): Promise<RunResult> {
  await ensureFrame();
  const f = frame!;
  const id = ++seq;
  const url = indexURL();
  return new Promise((resolve) => {
    let phase: 'loading' | 'starting' | 'running' = 'loading';
    // Drop the stored files (in case they are the cause) and the frame, so the
    // next run starts over from a download.
    const startOver = (reason: string) => {
      void caches.delete(cacheName(url)).catch(() => {});
      reset(reason);
    };
    const stop = () => {
      pending.delete(id);
      // A bad stored file makes Pyodide hang, not fail.
      if (phase === 'starting') startOver('Stopped.');
      else reset('Stopped.');
      resolve({
        error:
          phase === 'loading'
            ? 'Python took too long to load. Please check your connection and try again.'
            : phase === 'starting'
              ? 'Python took too long to start. Please try again.'
              : `Stopped: the example ran for more than ${RUN_TIMEOUT_MS / 1000} seconds.`,
      });
    };
    let timer = setTimeout(stop, LOAD_TIMEOUT_MS);
    pending.set(id, {
      running: () => {
        phase = 'running';
        loaded = true;
        clearTimeout(timer);
        timer = setTimeout(stop, RUN_TIMEOUT_MS);
        onRunning?.();
      },
      done: (r) => {
        clearTimeout(timer);
        if (r.version) loaded = true;
        resolve(r);
        if (phase !== 'running' && r.error && frame === f) startOver('Python failed to start.');
      },
    });
    void (async () => {
      const files = await (runtime ??= loadRuntime(url));
      if (frame !== f || !pending.has(id)) return; // stopped meanwhile
      // The first message to this frame carries the files (transferred, not copied).
      const send = files && !handedOver ? files : undefined;
      if (send) handedOver = true;
      const message = { type: 'run', id, code, indexURL: url, module: context?.module ?? '', name: context?.name ?? '', files: send };
      // The sandboxed frame's origin is opaque ("null"), so '*' is the only target that works.
      f.contentWindow!.postMessage(message, '*', send ? Object.values(send) : []);
      if (send) {
        phase = 'starting';
        clearTimeout(timer);
        timer = setTimeout(stop, START_TIMEOUT_MS);
      }
    })();
  });
}
