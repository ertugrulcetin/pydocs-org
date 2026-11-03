// Site-wide constants. The Python version moves to data/py-3.15/meta.json once
// the extractor output is wired in (PLAN.md Phase 2).
export const SITE_NAME = 'PyDocs';
export const SITE_URL = 'https://pydocs.org';
export const TITLE_SUFFIX = 'PyDocs - Community-Powered Python Documentation and Examples';
export const DEFAULT_DESCRIPTION =
  'PyDocs is a community-powered documentation and examples repository for the Python standard library.';
export const PYTHON_VERSION = '3.15.2';
export const REPO_URL = 'https://github.com/ertugrulcetin/pydocs-org';

/**
 * Public URL path for a built page. With `build.format: 'file'`, Astro reports
 * `/index.html` and `/os.path/join.html`; the served URLs are `/` and
 * `/os.path/join` (PLAN.md §4).
 */
export const pagePath = (pathname: string): string => {
  const p = pathname.replace(/\.html$/, '');
  return p === '/index' || p === '' ? '/' : p;
};

/** Login link that returns to `path` afterwards (PLAN.md §8: same-origin relative paths only). */
export const loginHref = (path: string): string => `/auth/login?return=${encodeURIComponent(path)}`;
