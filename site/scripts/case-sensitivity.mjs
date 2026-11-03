import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** True if `dir` (path or file URL) lives on a case-insensitive file system. */
export async function isCaseInsensitive(dir) {
  const base = typeof dir === 'string' ? dir : fileURLToPath(dir);
  const probe = await mkdtemp(join(base, '.case-probe-'));
  try {
    await writeFile(join(probe, 'Aa'), '');
    await stat(join(probe, 'aA'));
    return true;
  } catch {
    return false;
  } finally {
    await rm(probe, { recursive: true, force: true });
  }
}
