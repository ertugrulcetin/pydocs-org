// Runs example code with Pyodide in a sandboxed iframe (public/runner.js).
// The frame is created on the first run and reused; it is removed (which stops
// the Python worker) if a run takes too long.
export interface RunResult {
  output?: string;
  error?: string;
  /** Python version Pyodide runs, e.g. "3.14.2". */
  version?: string;
}

const LOAD_TIMEOUT_MS = 90_000; // first run downloads ~13 MB
const RUN_TIMEOUT_MS = 10_000;

let frame: HTMLIFrameElement | null = null;
let ready: Promise<void> | null = null;
let onMessage: ((e: MessageEvent) => void) | null = null;
let loaded = false;
let seq = 0;
interface Pending {
  done: (r: RunResult) => void;
  /** Python has loaded and the code starts running now. */
  running: () => void;
}
const pending = new Map<number, Pending>();

/** True once Python has loaded in this page (later runs are fast). */
export const pythonLoaded = () => loaded;

function reset(reason: string): void {
  if (onMessage) removeEventListener('message', onMessage);
  frame?.remove();
  frame = null;
  ready = null;
  onMessage = null;
  loaded = false;
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
 * the 10-second run limit starts then, not while Python downloads.
 */
export async function runPython(code: string, onRunning?: () => void): Promise<RunResult> {
  await ensureFrame();
  const id = ++seq;
  const base = document.querySelector<HTMLMetaElement>('meta[name="pydocs:pyodide"]')?.content ?? '';
  const indexURL = new URL(base, location.origin).href;
  return new Promise((resolve) => {
    let phase: 'loading' | 'running' = 'loading';
    const stop = () => {
      pending.delete(id);
      reset('Stopped.');
      resolve({
        error:
          phase === 'loading'
            ? 'Python took too long to load. Please check your connection and try again.'
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
      },
    });
    // The sandboxed frame's origin is opaque ("null"), so '*' is the only target that works.
    frame!.contentWindow!.postMessage({ type: 'run', id, code, indexURL }, '*');
  });
}
