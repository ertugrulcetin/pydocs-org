# PyDocs

Community-powered documentation and examples for the Python standard library, at [pydocs.org](https://pydocs.org).
A port of [ClojureDocs](https://clojuredocs.org) ([source](https://github.com/nubank/clojuredocs)) to Python 3.15.

Status: early development. [PLAN.md](PLAN.md) is the single source of truth for scope, architecture, and progress.

## Layout

- `extractor/`: builds the reference data in `data/py-3.15/` from the official Python docs (Python 3.15 + uv)
- `site/`: the Astro static site plus one Cloudflare Worker for `/api/*` and `/auth/*`
- `scripts/`: Cloudflare setup and data jobs

## License

Code: [Eclipse Public License 2.0](LICENSE). Community contributions: CC0.
Python documentation text © Python Software Foundation (PSF License v2).
See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the rest.
