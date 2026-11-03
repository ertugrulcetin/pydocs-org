// Versioned URLs for files in public/ (CSS, icons): "?v=<content hash>", so a
// changed file reaches every visitor at once even though /css/* is cached.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const cache = new Map<string, string>();

export function versioned(path: string): string {
  let url = cache.get(path);
  if (!url) {
    const hash = createHash('sha256').update(readFileSync(resolve(process.cwd(), `public${path}`))).digest('hex').slice(0, 10);
    url = `${path}?v=${hash}`;
    cache.set(path, url);
  }
  return url;
}
