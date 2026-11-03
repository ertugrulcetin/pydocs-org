// @ts-check
import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';
import indexPages from './integrations/index-pages.mjs';
import caseCheck from './integrations/case-check.mjs';

// https://astro.build/config
export default defineConfig({
  site: 'https://pydocs.org',
  output: 'static',
  // One `{path}.html` file per page (os.path.html, os.path/join.html), served by
  // Workers static assets at clean URLs with no trailing slash. See PLAN.md §4.
  build: { format: 'file' },
  trailingSlash: 'never',
  integrations: [preact(), indexPages(), caseCheck()],
  // Never inline scripts: shared files are cached across 11.5k pages, and the
  // CSP (PLAN.md §11) allows scripts from self only.
  vite: { build: { assetsInlineLimit: 0 } },
});
