# PyDocs

Community-powered documentation and examples for the Python standard library, at [pydocs.org](https://pydocs.org).
A port of [ClojureDocs](https://clojuredocs.org) ([source](https://github.com/nubank/clojuredocs)) to Python 3.15.

[PLAN.md](PLAN.md) is the single source of truth for scope, architecture, and progress.

## How it works

- **Reference docs** for 11,223 symbols in 320 modules are generated from the official Python 3.15.2 docs by `extractor/` into `data/py-3.15/` (committed).
- **The site** (`site/`) is a static Astro build: one page per module and per symbol, with ClojureDocs' layout and CSS.
- **Community content** (examples, see-alsos, notes) lives as JSON in Cloudflare R2.
  - It is written through one small Cloudflare Worker (`site/worker/`), which also serves the static files.
  - It is read straight from `data.pydocs.org`.
  - A nightly build bakes it into the pages.
- **Login** is GitHub OAuth with a signed session cookie. Everything runs on the Cloudflare and GitHub Actions free tiers.

## Layout

| Path | What |
|---|---|
| `extractor/` | Python 3.15.2 + uv. Builds `data/py-3.15/` from the docs archive and `inspect` |
| `data/py-3.15/` | Generated reference data, one JSON record per line |
| `site/` | Astro site (`src/`), the Worker (`worker/`), shared types (`shared/`), tests |
| `scripts/` | Cloudflare setup, seeding examples from the docs' doctests |
| `.github/workflows/` | `deploy.yml` (push + nightly), `extract.yml` (manual) |

## Develop

Needs [uv](https://docs.astral.sh/uv/) and Node 26 (`.nvmrc`).

```sh
# Reference data (about 7 s; downloads the 11.5 MB docs archive once)
cd extractor && uv sync && uv run pydocs-extract && uv run pytest

# Site
cd site && npm ci
npm run build          # astro build into dist/
npx astro preview      # static pages at http://localhost:4321 (no Worker)
npm run preview        # build + wrangler dev at http://localhost:8787 (Worker, local R2)
npm test               # unit tests (search, highlighter, Worker, CPU budget)
npm run typecheck:site && npm run typecheck:worker
npm run check:layout   # with a server on :4321; no sideways scroll, nothing sticking out of boxes
```

For login under `npm run preview`, copy `site/.dev.vars.example` to `site/.dev.vars` and fill in a GitHub OAuth app whose callback is `http://localhost:8787/auth/callback`.

To bake real community content into a local build, run `node scripts/snapshot.mjs` in `site/` first. It needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`; without them it writes an empty snapshot.

## Deploy

Every push to `master` (and a nightly run) tests, builds on Linux, and deploys with `wrangler deploy` (`deploy.yml`).
Builds must run on a case-sensitive file system: 29 symbols differ only in case (`logging/DEBUG` vs `logging/debug`).
On macOS's default disk, `npm run deploy` refuses to deploy for that reason.

## License

Code: [Eclipse Public License 2.0](LICENSE). Community contributions: CC0.
Python documentation text © Python Software Foundation (PSF License v2).
See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the rest.
