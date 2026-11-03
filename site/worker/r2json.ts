// JSON documents in R2 with optimistic concurrency (PLAN.md §7.4):
// read + ETag, change, conditional put; retry on conflict.
// First write uses create-if-absent (etagDoesNotMatch "*"), verified on R2.

export class ConflictError extends Error {
  constructor(key: string) {
    super(`write conflict on ${key}`);
  }
}

export interface JsonPutOptions {
  /** Cache-Control for objects served on data.pydocs.org. */
  cacheControl?: string;
}

const PUBLIC_CACHE = 'public, max-age=60';

export async function getJson<T>(bucket: R2Bucket, key: string): Promise<T | null> {
  const obj = await bucket.get(key);
  return obj ? ((await obj.json()) as T) : null;
}

export async function putJson(bucket: R2Bucket, key: string, value: unknown, opts: JsonPutOptions = {}): Promise<void> {
  await bucket.put(key, JSON.stringify(value), {
    httpMetadata: { contentType: 'application/json', cacheControl: opts.cacheControl ?? PUBLIC_CACHE },
  });
}

/**
 * Read-modify-write `key`. `change` gets the current value (null if absent)
 * and returns the new value, or `undefined` to leave the object unchanged.
 * Retries up to `attempts` times on a concurrent write, then throws ConflictError.
 */
export async function updateJson<T>(
  bucket: R2Bucket,
  key: string,
  change: (current: T | null) => T | undefined,
  opts: JsonPutOptions & { attempts?: number } = {},
): Promise<T | null> {
  const attempts = opts.attempts ?? 5;
  for (let i = 0; i < attempts; i++) {
    const obj = await bucket.get(key);
    const current = obj ? ((await obj.json()) as T) : null;
    const next = change(current);
    if (next === undefined) return current;
    const written = await bucket.put(key, JSON.stringify(next), {
      onlyIf: obj ? { etagMatches: obj.etag } : { etagDoesNotMatch: '*' },
      httpMetadata: { contentType: 'application/json', cacheControl: opts.cacheControl ?? PUBLIC_CACHE },
    });
    if (written) return next;
  }
  throw new ConflictError(key);
}
