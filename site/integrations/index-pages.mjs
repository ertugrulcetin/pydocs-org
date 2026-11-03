// Moves pages whose last URL segment is `index` (e.g. /operator/index for
// operator.index) out of the way. Workers static assets read
// `operator/index.html` as the folder index of /operator/, which breaks both
// URLs. We move it to `_idx/operator.index.html` and add a `_redirects`
// 200 rewrite, so /operator/index keeps its clean URL. See PLAN.md §4.
import { appendFile, mkdir, readdir, rename } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_STATIC_REDIRECTS = 2000; // Workers static assets limit

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

/** @returns {import('astro').AstroIntegration} */
export default function indexPages() {
  return {
    name: 'pydocs:index-pages',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        const root = fileURLToPath(dir);
        const moved = [];
        for await (const file of walk(root)) {
          const rel = relative(root, file).split(sep).join('/');
          if (!rel.endsWith('/index.html') || rel.startsWith('_idx/')) continue;
          const urlPath = '/' + rel.slice(0, -'.html'.length); // /operator/index
          const flat = rel.slice(0, -'.html'.length).replaceAll('/', '.'); // operator.index
          await mkdir(join(root, '_idx'), { recursive: true });
          await rename(file, join(root, '_idx', `${flat}.html`));
          moved.push(`${urlPath}  /_idx/${flat}  200`);
        }
        if (moved.length > MAX_STATIC_REDIRECTS) {
          throw new Error(`${moved.length} index pages exceed the ${MAX_STATIC_REDIRECTS} _redirects limit`);
        }
        if (moved.length) {
          await appendFile(join(root, '_redirects'), moved.join('\n') + '\n');
        }
        logger.info(`moved ${moved.length} index page(s) to /_idx/`);
      },
    },
  };
}
