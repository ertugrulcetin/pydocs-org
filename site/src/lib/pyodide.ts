// Where the self-hosted Pyodide runtime is served (copied there at build time
// by integrations/pyodide.mjs): /pyodide/<version>/.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve('pyodide/pyodide.mjs'));
export const PYODIDE_VERSION: string = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version;
export const PYODIDE_PATH = `/pyodide/${PYODIDE_VERSION}/`;
