// Test doubles for the Worker: an in-memory R2 that enforces ETag conditions
// like the real one (PLAN.md §7.4 spike), assets with a symbol manifest, and env.
import type { AppEnv } from '../worker/env.ts';

export class FakeR2 {
  objects = new Map<string, { body: string; etag: string }>();
  n = 0;
  /** Simulate a concurrent writer: change the object right after the next get(). */
  raceOnNextGet: ((key: string) => void) | null = null;
  async get(key: string) {
    const o = this.objects.get(key);
    const race = this.raceOnNextGet;
    this.raceOnNextGet = null;
    race?.(key);
    return o ? { etag: o.etag, json: async () => JSON.parse(o.body) } : null;
  }
  async head(key: string) {
    const o = this.objects.get(key);
    return o ? { etag: o.etag } : null;
  }
  async put(key: string, body: string, opts: { onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string } } = {}) {
    const cur = this.objects.get(key);
    const c = opts.onlyIf;
    if (c?.etagMatches !== undefined && cur?.etag !== c.etagMatches) return null;
    if (c?.etagDoesNotMatch === '*' && cur) return null;
    const etag = `e${++this.n}`;
    this.objects.set(key, { body, etag });
    return { etag };
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
  read(key: string) {
    const o = this.objects.get(key);
    return o ? JSON.parse(o.body) : undefined;
  }
  keys(prefix = '') {
    return [...this.objects.keys()].filter((k) => k.startsWith(prefix)).sort();
  }
}

export const SECRET = 'test-secret-0123456789';
export const SYMBOLS = ['builtins/len', 'builtins/str.split', 'os.path/join', 're/split'];

export type TestEnv = AppEnv & { content: FakeR2; private: FakeR2 };

export const makeEnv = (): TestEnv => {
  const content = new FakeR2();
  const priv = new FakeR2();
  const assets = {
    fetch: async (u: string) =>
      new URL(u).pathname === '/manifest/symbols.txt' ? new Response(SYMBOLS.join('\n') + '\n') : new Response('nope', { status: 404 }),
  };
  return {
    GITHUB_CLIENT_ID: 'cid',
    GITHUB_CLIENT_SECRET: 'csecret',
    SESSION_SECRET: SECRET,
    ADMIN_GITHUB_IDS: '1',
    CONTENT: content as unknown as R2Bucket,
    PRIVATE: priv as unknown as R2Bucket,
    ASSETS: assets as unknown as Fetcher,
    content,
    private: priv,
  } as TestEnv;
};

/** Collects ctx.waitUntil promises so tests can await side writes. */
export const makeCtx = () => {
  const pending: Promise<unknown>[] = [];
  return { waitUntil: (p: Promise<unknown>) => void pending.push(p), settle: () => Promise.all(pending), passThroughOnException() {} };
};
