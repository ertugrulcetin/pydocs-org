// Copies the Pyodide runtime (npm package "pyodide") into dist/pyodide/<version>/
// so the example runner is self-hosted: no third-party scripts, and the CSP
// stays "self" only. Only the files needed for the standard library are copied.
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// pyodide.js is the classic build the runner's worker loads with importScripts;
// it imports pyodide.asm.mjs itself.
const FILES = ['pyodide.js', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json'];

export async function pyodideInfo() {
  const require = createRequire(import.meta.url);
  const pkgDir = dirname(require.resolve('pyodide/pyodide.mjs'));
  const { version } = JSON.parse(await readFile(join(pkgDir, 'package.json'), 'utf8'));
  return { pkgDir, version, path: `/pyodide/${version}/` };
}

/** @returns {import('astro').AstroIntegration} */
export default function pyodide() {
  return {
    name: 'pydocs:pyodide',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        const { pkgDir, version, path } = await pyodideInfo();
        const out = join(fileURLToPath(dir), path);
        await mkdir(out, { recursive: true });
        await Promise.all(FILES.map((f) => copyFile(join(pkgDir, f), join(out, f))));
        logger.info(`copied Pyodide ${version} (${FILES.length} files) to ${path}`);
      },
    },
  };
}
