# PyDocs: Plan & TODO

> Community-powered documentation and examples for Python. A faithful port of
> [ClojureDocs](https://clojuredocs.org) ([source](https://github.com/nubank/clojuredocs))
> to the Python standard library, hosted for $0 on Cloudflare.

**This file is the single source of truth.** Every decision, task, and open question lives here.
When something changes, update this file in the same commit.

- **Status:** 🚧 Phase 0 started (2026-11-03). Architecture questions Q1–Q4 answered (2026-11-01).
- **Last updated:** 2026-11-03
- **Legend:** `[ ]` todo · `[~]` in progress · `[x]` done · ❓ needs your decision · ⚠️ risk to verify early

---

## 0. TL;DR

- **Static site** (Astro). One pre-rendered page per stdlib object (11,557 objects in 320 modules for Python 3.15). Same layout, CSS class names, and flows as ClojureDocs.
- **Reference docs** are generated at build time from the official Python 3.15 docs plus `inspect` introspection.
- **Community content** (examples, see-alsos, notes) is stored as JSON in **R2**. It is written through one small **Cloudflare Worker** and **baked into the static pages nightly** so search engines can crawl it. Pages also fetch the live JSON after load, so new contributions show up at once.
- **GitHub login** via OAuth with a stateless, signed session cookie.
- Everything fits in the Cloudflare free tier plus the GitHub Actions free tier.

### Reality check on "client-only"

A browser-only app cannot do two things we need:

1. **GitHub login.** Exchanging the OAuth `code` for a token needs the app's *client secret*. GitHub's token endpoint also blocks browser (CORS) calls.
2. **Writing to R2.** Write credentials can never ship to the browser.

So we use **one Cloudflare Worker with static assets**: the static site and a small serverless handler, deployed together. The handler is free up to 100k requests/day. There is no server to run or pay for. Only `/api/*` and `/auth/*` run the Worker (`run_worker_first` in `wrangler.toml`). Every page view is a static file and costs nothing.

**Why Workers and not Pages** (changed 2026-11-03). Cloudflare's Pages docs now say "Start new projects with Workers", and `wrangler pages project create` sends new projects to Workers. Workers static assets has the same free limits we rely on: 20,000 files per version, 25 MiB per file, and free, unlimited requests for static files.

---

## 1. Goals & non-goals

**Goals**
- Feature and UX parity with ClojureDocs (see [§5 parity matrix](#5-feature-parity-matrix)), adapted to Python.
- Pixel-close UI. We mirror ClojureDocs' DOM structure and CSS class names and reuse its compiled CSS, so the look matches by construction.
- $0 running cost. No servers. Static pages keep working even if a free-tier quota runs out.
- Open data. All community content is CC0, exported nightly, and backed up.

**Non-goals (for v1)**
- Third-party packages (numpy, requests, …). Stdlib only (Q3, decided).
- Multiple Python versions side by side. v1 has one version: latest stable, **3.15**.
- Voting or reputation. ClojureDocs has neither today.
- A rich code editor. ClojureDocs uses a plain auto-growing textarea, and so do we.

---

## 2. Architecture

```
 BUILD  (GitHub Actions: on push to main + nightly cron)
 ┌───────────────────────┐   ┌─────────────────────────┐   ┌──────────────────────┐
 │ extractor/ (Python)   │──▶│ data/py-3.15/*.json     │──▶│ site/ (Astro build)  │──▶ wrangler deploy
 │ docs HTML + inspect   │   │ (committed to git)      │   │ ~12k static pages    │    (Worker + assets)
 └───────────────────────┘   └─────────────────────────┘   │ + search index       │
                             ┌─────────────────────────┐   │ + baked community    │
                             │ R2 snapshot (S3 API,    │──▶│   content            │
                             │ read-only key)          │   └──────────────────────┘
                             └─────────────────────────┘

 RUNTIME
 Browser ──GET page──────────────▶ Workers static assets (free, unlimited)
    │
    ├──GET live JSON──▶ [A] R2 public bucket on data.<domain> (CDN cached)    ← if we own a domain
    │                   [B] GET /api/s/... → Worker → R2                      ← workers.dev only
    │
    └──POST/PATCH/DELETE /api/*, GET /auth/* ──▶ Worker ──▶ R2 (pydocs-content, pydocs-private)
                                                      └──▶ GitHub OAuth + /user (at login only)
```

**Read path.** The HTML already contains the community content as of the last bake. A small script then fetches the symbol's live JSON and re-renders the widgets if anything changed. **Decided: path [A]** (we own a domain), so reads use no Worker quota. Path [B] (one Worker request per symbol page view) stays only as a fallback, e.g. for local dev.

**Write path.** Worker → verify session → validate → read-modify-write the symbol's JSON with an R2 conditional put (ETag) → best-effort index updates → return the new doc. Details in [§7.4](#74-write-algorithm--consistency).

**Graceful degradation.** If the Workers daily quota runs out, pages still load with the baked content. Only live refresh and writes fail until the quota resets.

---

## 3. Tech stack

| Concern | Choice | Why |
|---|---|---|
| Site generator | **Astro** (static output) | Pre-renders 12k pages fast. Ships zero JS by default. "Islands" only where needed. |
| Interactive widgets | **Preact** islands + TypeScript | Small (~4 KB). Same model as ClojureDocs' Reagent/React widgets. |
| CSS | **Ported ClojureDocs CSS** + Bootstrap 3 + Font Awesome 4 (the same versions they use) | "Exact same UI" with the least effort. Light/dark via CSS variables, as they do. |
| Python syntax highlight | **Prism** (build time and client) | Tiny. One highlighter for baked and live content. Token colors mapped to ClojureDocs' `--syntax-*` variables. |
| Markdown (notes) | **marked** + **DOMPurify** (strict allowlist) | ClojureDocs uses marked. Sanitizing is required for user HTML. |
| Search | Prebuilt JSON index + small custom ranker (or MiniSearch) | Fully static. Lazy-loaded when the search box gets focus. |
| Backend | **One Cloudflare Worker** (TypeScript, small router), with the site as its static assets | Free. One deploy for site and API. Native R2 binding. |
| Storage | **Cloudflare R2**: `pydocs-content` (public-safe), `pydocs-private` (bans, rate limits, audit log) | Your choice. A good fit: per-symbol JSON can be served straight from the CDN. |
| Validation | **zod** schemas in `shared/`, used by both islands and the Worker | One set of rules and error messages. |
| Reference data extractor | **Python 3.15** + **uv**, `selectolax`/`beautifulsoup4`, `inspect` | Must run on the documented Python version. |
| CI/CD | **GitHub Actions** → `wrangler deploy` | Free. The Python build step is easy. Avoids Cloudflare build limits. |
| Tests | pytest (extractor), Vitest + `@cloudflare/vitest-pool-workers` (Worker), Playwright (e2e and screenshot diff vs ClojureDocs) | |
| Analytics | Cloudflare Web Analytics | Free and cookieless. Replaces ClojureDocs' Matomo. |

---

## 4. Information architecture (URL map)

| URL | Page (ClojureDocs equivalent) | Rendering |
|---|---|---|
| `/` | Home (`/`) | static + live refresh of "Recently Updated" |
| `/library` | Stdlib overview (`/core-library`) | static |
| `/library/all` | All objects (`/core-library/vars`) | static |
| `/quickref` | Quick reference (`/quickref`) | static |
| `/search?q=…&page=…` | Search results (`/search`) | static shell + client render |
| `/{module}` | Module page (`/:ns`), e.g. `/builtins`, `/os.path`, `/xml.etree.ElementTree` | static |
| `/{module}/{qualname}` | Symbol page (`/:ns/:name`), e.g. `/builtins/len`, `/builtins/str.split`, `/collections/Counter.most_common` | static + live refresh |
| `/ex/{exampleId}` | Example history (`/ex/:id`) | shell + client (`_redirects` 200 rewrite) |
| `/u/{login}` | User page (`/u/:login`) | shell + client (`_redirects` 200 rewrite) |
| `/examples-styleguide`, `/contribute` | Same | static |
| `/concepts/{slug}` | Concept pages | static (Phase 8) |
| `/auth/login`, `/auth/callback`, `/auth/logout` | `/gh-callback`, `/logout` | Worker |
| `/api/*` | `/api/*` | Worker |
| `/export.json`, `/sitemap.xml`, `/robots.txt`, `/opensearch.xml` | Same idea | static |

Naming rules:
- The Python inventory lists builtins with no module prefix (`len`, `str.split`). We map them to module **`builtins`**, the counterpart of `clojure.core`.
- **Symbol id** = `{module}/{qualname}` (e.g. `os.path/join`). It is used in URLs, R2 keys, and see-alsos.
- **File layout (spike result, 2026-11-03):** emit one `{path}.html` file per page, e.g. `os.path.html`, `os.path/join.html`, `builtins/str.split.html`. Workers static assets serve them at clean URLs with no trailing slash: `/os.path`, `/os.path/join`, `/builtins/str.split`. `/x/` and `/x.html` redirect (307) to `/x`. Don't use `…/index.html` folders: they force trailing-slash URLs.
- **Pages whose last segment is `index`** (e.g. `operator/index`): `operator/index.html` would be read as the folder index and break `/operator`. Emit them as `_idx/{module}.{qualname}.html` and add a `_redirects` 200 rewrite (`/operator/index  /_idx/operator.index  200`). Tested: clean URL, 200. `_redirects` allows 2,000 static rules, and only a few symbols need this.
- Reserved top-level names (no stdlib module may use them): `library`, `quickref`, `search`, `ex`, `u`, `api`, `auth`, `concepts`, `shell`, `_data`, `_idx`. The build fails on a clash. (Shell pages for `/u/*` and `/ex/*` live under `/shell/`, because Astro doesn't route `_`-prefixed folders.)

---

## 5. Feature parity matrix

Source references point into `nubank/clojuredocs`.

| # | ClojureDocs feature | Source | PyDocs equivalent | Phase |
|---|---|---|---|---|
| 1 | Navbar: brand, Core Library, Quick Ref, "Log In" (GitHub) or avatar + "Log Out", search box "Looking for? (ctrl-s)" | `pages/common.clj` `$navbar` | Same. "Standard Library" replaces "Core Library". Shows the Python version. | 2, 3 |
| 2 | GitHub stars counter in the home navbar | `github.clj` `repo-stats` | Stars of the PyDocs repo, fetched at build | 2 |
| 3 | Mobile slide-out menu with per-page sections | `$mobile-navbar-nav` | Same | 2 |
| 4 | Home: headline, big search with autocomplete, Example of the Day, Recently Updated (3 items), Contribute teaser, "clojure.core, by purpose" (4 categories × 10, "+N more"), "More namespaces" cards | `pages/intro.clj` | "builtins, by purpose" and "More modules" cards (`os.path`, `collections`, `itertools`, `functools`, `re`, `json`, `pathlib`, `datetime`) | 2, 4 |
| 5 | Core library overview with a blurb per namespace | `core-library-handler` | `/library`: modules grouped by docs.python.org library chapter | 2 |
| 6 | All vars, grouped by namespace then first letter | `core-library-vars-handler` | `/library/all` | 2 |
| 7 | Namespace page: doc, extra markdown, vars by letter with doc; sidebar namespace tree | `pages/nss.clj`, `$library-nav` | Module page. Sidebar tree splits dotted names (`os` › `os.path`) and is grouped by library chapter. | 2 |
| 8 | Var header: name, namespace link, "Available since", source link, dialect badges, "Implementation detail" badge and notice | `pages/vars.clj` `$var-header` | Name, module link, kind (function/method/class/…), "Added in 3.x", source link (pure-Python modules only, to CPython at the release tag), **availability badges** (Unix/Windows/macOS/Linux/WASI/Emscripten) in place of dialect badges, **Deprecated** badge, private/impl-detail badge | 2 |
| 9 | Arglists (several per var) | `$arglist` | Signatures. Several when the docs list overloads (e.g. `range(stop)`, `range(start, stop, step)`). | 2 |
| 10 | Docstring in `<pre>` + "© Rich Hickey… EPL" line | var page | Docstring + "© Python Software Foundation · PSF License v2" + "Official docs ↗" link + "Changed in" list (collapsed) | 2 |
| 11 | Examples list: contributor avatars (author + editors, max 7 + "N more"), `link / edit / delete` (with "confirm delete?"), highlighted when `#example-<id>` matches, syntax highlight | `examples.cljs` | Same | 4 |
| 12 | Add or edit example: tabbed editor "Code Here" / "Live Preview", style guide and CC0 notice, Cancel/Submit, spinner, inline errors | `examples.cljs` | Same. Tab inserts 4 spaces. Ctrl/Cmd+Enter submits. | 4 |
| 13 | Wiki-style editing: any logged-in user can edit any example, history is kept; only the author can delete (soft delete) | `api/examples.clj` | Same, plus admin override | 4 |
| 14 | Example history page (newest first) | `vars.clj` `example-handler` | Same | 4 |
| 15 | See also: list with doc excerpt and "Added by" avatar; add with symbol autocomplete; reject duplicates and self-links; author can delete | `see_alsos.cljs`, `api/see_alsos.clj` | Same. Error texts kept ("Sorry, that see also already exists.") | 4 |
| 16 | Notes: Markdown with live preview ("Markdown allowed, code in `<pre />`"); author can edit and delete | `notes.cljs`, `api/notes.clj` | Same, sanitized | 4 |
| 17 | "Log in to add an example / a see-also / a note" | widgets | Same | 4 |
| 18 | Sticky left nav on the var page with section counts; mobile nav with count badges | `var_page.cljs`, `sticky.cljs` | Same | 2, 4 |
| 19 | "Recent" pages (stored in session) | `vars.clj` `:recent` | `localStorage` | 2 |
| 20 | SEO: title pattern, meta description, OG/Twitter tags, canonical URL, JSON-LD `SoftwareSourceCode` | `vars.clj` | Same (`programmingLanguage: Python`) + `sitemap.xml` | 2 |
| 21 | User page: 200px avatar, "User X has authored N examples.", sorted links | `pages/user.clj` | Same, plus note and see-also counts | 4 |
| 22 | Search page: 10 per page, prev/next, arglists, doc cut at 300 chars, example count, see-alsos | `pages.clj` `search-page-handler` | Same, rendered client-side from the static index | 2 |
| 23 | Autocomplete: ctrl-s focuses, ↑/↓ and ctrl-n/ctrl-p move, Esc cancels, Enter opens; "Nothing Found" | `mods/search.cljs`, `main.cljs` | Same | 2 |
| 24 | Quick reference with sticky TOC (spheres → categories → groups) | `pages/quickref.clj` | Our own Python quickref, hand-curated in YAML | 2 |
| 25 | Concept pages (Destructuring, Functional Programming) | `/concepts/:concept` | Comprehensions, Unpacking, Decorators, Context managers, Iterators & generators, … | 8 |
| 26 | Examples style guide | `src/md/examples-styleguide.md` | Python version (see [§9](#9-examples-style-guide-python-adaptation)) | 2 |
| 27 | Contribute page, with a "Still need an example:" list | `pages/contribute.clj` | Same. The list comes from the bake. | 2, 5 |
| 28 | GitHub OAuth login that returns to the current page; logout | `gh_auth.clj`, `github.clj` | Same | 3 |
| 29 | Full JSON data export | `export.clj` | `/export.json` nightly (CC0) + `pydocs-data` git repo as backup | 5 |
| 30 | See-also relations export | `api/server.clj` | Part of `export.json` | 5 |
| 31 | robots.txt, opensearch.xml, 404 and 500 pages, staging banner | various | Same. Preview deploys show the staging banner. | 2 |
| 32 | Light/dark theme via `light-dark()` CSS variables | `css.clj` | Same | 2 |
| 33 | Matomo analytics | `common.clj` | Cloudflare Web Analytics | 7 |
| 34 | Legacy URL redirects | `entry.clj` | Not needed | — |
| 35 | Internal dev styleguide pages | `pages/dev.clj` | Optional `/dev/styleguide`, dev builds only | 8 |

**PyDocs additions (not in ClojureDocs)**
- Admin moderation: delete anything, ban or unban a user, view the audit log. Phase 6.
- "report" link on each item that opens a prefilled GitHub issue (no backend needed). Phase 6.
- Run an example in the browser with **Pyodide** (loaded only on click). Phase 8.
- CI job that runs every example in Pyodide and flags broken ones. ClojureDocs' own 2026 vision doc (`docs/2026vison.md`) aims for executable, checked examples. Phase 8.

---

## 6. Reference data (generated by `extractor/`)

**Sources, pinned to one release: 3.15.2, the latest on 2026-11-03.**
1. `https://docs.python.org/3.15/objects.inv`: list of every documented object and its kind. Counts: 3,807 methods, 2,327 functions, 2,041 data, 1,536 attributes, 1,207 classes, 318 exceptions, 320 modules.
2. The offline docs archive `python-3.15-docs-html.tar.bz2`. We parse each `<dl class="py …">` block for signatures (several `<dt>`s), `versionadded`, `versionchanged`, `deprecated`, `availability`, "CPython implementation detail", and the anchor URL. One download, no scraping.
3. Introspection on a Python 3.15 interpreter: `inspect.getdoc` (docstring), `inspect.signature` / `__text_signature__` (fallback signature), `inspect.getsourcefile` + `getsourcelines` (source link for pure-Python code), coroutine and async-generator flags.
4. `library/index.html`: the chapter grouping for the sidebar and `/library` ("Text Processing Services", "Data Types", …).

**Fallbacks.** Windows-only or otherwise non-importable modules (`winreg`, `msvcrt`, …) get their text from the first paragraph of the docs. This is logged in the extractor's stats report.

**Output** (committed, so diffs can be reviewed):
```
data/py-3.15/
  meta.json            # {python: "3.15.0", docsTag, generatedAt, counts}
  chapters.json        # [{title, modules: [...]}]
  modules.json         # [{name, synopsis, doc, chapter, docsUrl, availability, deprecated}]
  symbols/{module}.json
  doctests/{module}.json   # >>> snippets per symbol, used to seed examples (Q4)
```
`Symbol` shape:
```jsonc
{
  "id": "builtins/str.split", "module": "builtins", "qualname": "str.split", "name": "split",
  "kind": "method",                // function|method|classmethod|staticmethod|class|exception|attribute|data|property|decorator
  "parent": "builtins/str",        // class id for methods and attributes
  "signatures": ["str.split(sep=None, maxsplit=-1)"],
  "doc": "Return a list of the substrings in the string, using sep as the separator string. ...",
  "docsUrl": "https://docs.python.org/3.15/library/stdtypes.html#str.split",
  "added": null,                   // "3.8" from versionadded
  "changed": [{"version": "3.x", "text": "..."}],
  "deprecated": null,              // {version, removedIn?, text}
  "availability": [],              // ["Unix", "not WASI"]
  "source": null,                  // {path: "Lib/json/__init__.py", line: 183} for pure-Python code
  "implDetail": false, "isAsync": false
}
```
Page budget: 11,557 symbol pages + 320 module pages + ~20 others + assets ≈ 12.5k files. The free-plan limit is **20,000 files**. A build check fails above 18,000.

---

## 7. Community data (R2)

### 7.1 Buckets & key layout

`pydocs-content`. Everything here is safe to make public.
```
symbols/{module}/{qualname}.json   # all community content for one symbol (source of truth)
history/{exampleId}.json           # every version of one example
users/{githubId}.json              # public profile + list of contributions
logins/{login-lowercase}.json      # {id} lookup for /u/{login}
activity/recent.json               # latest 100 events (home "Recently Updated")
```
`pydocs-private`. Never exposed.
```
bans/{githubId}.json
ratelimit/{githubId}/{yyyy-mm-dd-hh}.json
audit/{yyyy-mm-dd}/{ulid}.json     # one record per write: who, what, before/after
```

### 7.2 Schemas

```jsonc
// symbols/builtins/str.split.json
{
  "symbol": "builtins/str.split",
  "examples": [{
    "id": "ex_01JBX…",               // ULID: sortable, needs no index
    "body": "'a,b,c'.split(',')\n# => ['a', 'b', 'c']",
    "author":  {"id": 583231, "login": "octocat"},
    "editors": [{"id": 1, "login": "someone"}],
    "createdAt": 1761955200000, "updatedAt": 1761955200000,
    "deletedAt": null,
    "source": null                    // "python-docs" for seeded doctest examples
  }],
  "seeAlsos": [{"id": "sa_…", "to": "builtins/str.rsplit", "author": {…}, "createdAt": …}],
  "notes":    [{"id": "nt_…", "body": "markdown", "author": {…}, "createdAt": …, "updatedAt": …}],
  "updatedAt": 1761955200000
}
// history/ex_01JBX….json
{ "exampleId": "ex_01JBX…", "symbol": "builtins/str.split",
  "versions": [{"body": "…", "editor": {…}, "at": …}] }
// users/583231.json
{ "id": 583231, "login": "octocat", "joinedAt": …, "lastSeenAt": …,
  "contributions": [{"type": "example|seeAlso|note", "symbol": "…", "id": "…", "at": …}] }
```
- Avatars come from the GitHub id (`https://avatars.githubusercontent.com/u/{id}?s=64`), so we store no avatar URLs.
- **We store no emails, tokens, or other private data.**
- See-alsos are one-way (from → to), as in ClojureDocs. They show only on the "from" page.

### 7.3 Permissions (same as ClojureDocs, plus admin)

| Action | Anonymous | Logged in | Author | Admin |
|---|---|---|---|---|
| Read everything | ✓ | ✓ | ✓ | ✓ |
| Add example / see-also / note | | ✓ | | ✓ |
| Edit example (wiki-style, history kept) | | ✓ | ✓ | ✓ |
| Delete example (soft delete) | | | ✓ | ✓ |
| Delete see-also | | | ✓ | ✓ |
| Edit or delete note | | | ✓ | ✓ |
| Ban or unban user | | | | ✓ |

Admins are listed in the `ADMIN_GITHUB_IDS` environment variable.

### 7.4 Write algorithm & consistency

R2 has no transactions or queries. So:
1. Verify the session cookie (HMAC), check that the `Origin` header matches the site, and require `Content-Type: application/json`.
2. **Check the symbol id against the build manifest** (`env.ASSETS.fetch('/_data/symbols.txt')`). This blocks R2 key injection such as `../`.
3. Check the ban list and the rate limit.
4. Read `symbols/{id}.json` and keep its ETag. Apply the change. `put` with `onlyIf: { etagMatches }`. On conflict, retry up to 5 times, then return 409. For the first write (no object yet), use `onlyIf: { etagDoesNotMatch: "*" }` (create-if-absent). `etagMatches` on a missing key always fails. Tested on real R2, 2026-11-03.
5. Best-effort side writes: `history/`, `users/`, `logins/`, `activity/recent.json`, `audit/`.
6. Return the updated symbol doc. The widget re-renders from it.

`scripts/rebuild-indexes.ts` runs nightly. It rebuilds `users/*` and `activity/recent.json` from `symbols/*` and `audit/*`, so a failed side write heals itself.

---

## 8. API (Worker)

| Method & path | Body | Notes |
|---|---|---|
| `GET /auth/login?return=/path` | | Sets a random `state` cookie and redirects to GitHub. Scope is empty: public profile only. |
| `GET /auth/callback` | | Checks `state`, exchanges `code`, calls `GET /user`, upserts the user, sets the session cookie, redirects to `return` (same-origin relative paths only). |
| `GET /auth/logout` | | Clears the cookies and redirects to `/`. |
| `GET /api/s/{module}/{qualname}` | | Read-through for read path [B] only |
| `POST /api/s/{module}/{qualname}/examples` | `{body}` | |
| `PATCH /api/s/{module}/{qualname}/examples/{id}` | `{body}` | Any logged-in user. Appends to history and adds the user to `editors`. |
| `DELETE /api/s/{module}/{qualname}/examples/{id}` | | Author or admin. Soft delete. |
| `POST /api/s/{module}/{qualname}/see-alsos` | `{to}` | `to` must exist. No duplicates. No self-links. |
| `DELETE /api/s/{module}/{qualname}/see-alsos/{id}` | | Author or admin |
| `POST /api/s/{module}/{qualname}/notes` | `{body}` | |
| `PATCH` / `DELETE /api/s/{module}/{qualname}/notes/{id}` | `{body}` | Author or admin |
| `GET /api/ex/{id}`, `GET /api/u/{login}`, `GET /api/activity` | | Read path [B] only. With [A], the client reads the R2 objects directly. |
| `POST /api/admin/ban`, `POST /api/admin/unban` | `{login}` | Admin only |

- **Session.** Cookie `pd_session` = `base64url(payload).base64url(HMAC-SHA256)`, with payload `{uid, login, iat, exp}`. `HttpOnly; Secure; SameSite=Lax`, 30 days. A second cookie, `pd_user` (readable by JS), holds `{id, login}` so the navbar can show the user without a request. The GitHub token is thrown away right after `/user`.
- **Errors.** 401 not logged in · 403 not author or banned · 404 unknown symbol or item · 409 write conflict · 413 too large · 422 validation (ClojureDocs messages, e.g. "Whoops, looks like your example is blank.") · 429 rate limited.
- **Limits** (defaults): example ≤ 10,000 chars, note ≤ 5,000 chars, 20 writes/hour and 100/day per user. Accounts younger than 7 days can't post (account age comes from GitHub `created_at` at login).

---

## 9. Examples style guide (Python adaptation)

We port `examples-styleguide.md` and keep its spirit: short, unique, self-contained, broad *or* deep.
- Include every `import`. The reader knows programming but is new to Python.
- Show results as `# => value` comments (counterpart of Clojure's `;;=>`). `>>>` REPL style is also fine.
- Show printed output as `# prints: …`.
- No third-party packages. Must run on the documented Python version.
- The `# =>` convention also lets us check examples automatically later (Phase 8).

---

## 10. Free-tier budget & guardrails

| Resource | Free limit | Our use | Guardrail |
|---|---|---|---|
| Static asset requests | Unlimited | All page views | — |
| Asset files per Worker version | 20,000 | ≈ 12.5k | Build fails above 18k |
| Asset file size | 25 MiB | `export.json` grows over time | Split the export when it passes 20 MiB |
| Worker requests | 100k/day (whole account) | Writes, auth, and reads with path [B] | `run_worker_first` limits the Worker to `/api/*` and `/auth/*`. Use path [A] when possible. Over the limit, those routes return 429. |
| Workers CPU | 10 ms per request | JSON parse/serialize + HMAC | Keep symbol docs small. Load-test the largest doc. |
| R2 storage | 10 GB-month | Text only: MBs | — |
| R2 Class A (writes, lists) | 1M/month | ~5 per contribution + nightly lists | — |
| R2 Class B (reads) | 10M/month | Path [A]: only CDN cache misses. Path [B]: 1 per page view. | Cache headers on objects |
| GitHub Actions | Unlimited for public repos (2,000 min/month private) | ~5 min/day | Make the repo public (❓ Q7) |

⚠️ **R2 needs a payment method on the account to activate, even for the free tier.** Accepted (Q1). Add the payment method *before* enabling R2: in 2025 some users couldn't add one during R2 activation.

---

## 11. Security & abuse

- **XSS.** Example bodies are always rendered as escaped text through Prism tokens, never as raw HTML. Notes go through marked + DOMPurify with an allowlist. We sanitize the same way at build time (bake) and in the browser.
- **CSRF.** `SameSite=Lax` cookie + `Origin` check + JSON content type on every write.
- **Open redirect.** `return` must be a relative path on our own site.
- **Key injection.** Symbol ids must exist in the build manifest. Item ids must match the ULID format.
- **Headers** (`_headers`): CSP (scripts from self only; images from self and `avatars.githubusercontent.com`), `X-Content-Type-Options`, `Referrer-Policy`, `frame-ancestors 'none'`.
- **Secrets** (Worker secrets, `wrangler secret put`): `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `SESSION_SECRET`, `ADMIN_GITHUB_IDS`. GitHub Actions secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, R2 S3 read-only key pair.
- **Abuse.** Rate limits, minimum account age, bans, soft deletes, audit log, nightly backups, admin UI, report link.

---

## 12. Repo layout

```
pydocs-org/
├── PLAN.md                       # this file
├── extractor/                    # Python 3.15 + uv: builds data/py-3.15
│   ├── pyproject.toml
│   ├── pydocs_extract/           # inventory.py, docs_html.py, introspect.py, chapters.py, doctests.py, main.py
│   └── tests/
├── data/py-3.15/                 # generated reference data (committed)
├── shared/                       # TS types, zod schemas, error messages, symbol-id helpers
├── site/                         # Astro project (static output) + the Worker; one `wrangler deploy`
│   ├── astro.config.mjs
│   ├── wrangler.toml             # assets dir, run_worker_first, R2 bindings CONTENT/PRIVATE, custom domain
│   ├── worker/                   # Worker code: router, auth/*, api/*
│   ├── public/                   # _headers, _redirects, robots.txt, opensearch.xml, img/
│   └── src/
│       ├── layouts/Main.astro    # = ClojureDocs $main (head, navbars, footer)
│       ├── components/           # Navbar, MobileNav, LibraryNav, SymbolHeader, Signatures, Docstring, …
│       ├── islands/              # Search, Examples, SeeAlsos, Notes, UserArea, Activity, UserPage, ExampleHistory, Admin
│       ├── pages/                # index, library/, quickref, search, [module]/, [module]/[qualname], ex, u, …
│       ├── content/              # styleguide.md, contribute.md, library intro, module blurbs, quickref.yaml
│       └── styles/               # bootstrap-3.min.css, font-awesome-4.min.css, clojuredocs-app.css (EPL), pydocs.css
├── scripts/                      # bake-community.ts, rebuild-indexes.ts, export.ts, seed-doctests.ts
└── .github/workflows/            # ci.yml, deploy.yml (push + nightly), extract.yml (manual)
```

---

## 13. TODO by phase

### Phase 0: Decisions, accounts, spikes
- [x] Answer architecture questions Q1–Q4 (2026-11-01)
- [ ] Answer the remaining questions Q5–Q11 in §16 (defaults apply if unanswered)
- [~] Create the GitHub repo (public recommended) and add a `LICENSE` (see §17). Repo `ertugrulcetin/pydocs-org` is public (2026-11-03, branch `master`). Still to do: `LICENSE` (§17).
- [x] Cloudflare: add a payment method, enable R2, create buckets `pydocs-content` and `pydocs-private`. Payment method and R2 were already active; buckets created 2026-11-03 by `scripts/setup-cloudflare.sh` (safe to re-run).
- [x] Worker `pydocs`: the first `wrangler deploy` creates it, so there is no separate project step. Its custom domain is set in `wrangler.toml` (`routes` with `custom_domain = true`). First deployed 2026-11-03 with a placeholder page: https://pydocs.org and https://pydocs.ertu-ctn.workers.dev.
- [ ] GitHub OAuth Apps: **prod** (callback `https://<domain>/auth/callback`) and **dev** (`http://localhost:8787/auth/callback`). One callback host per app. Login won't work on preview deploys.
- [x] Buy `pydocs.org` through Cloudflare Registrar (2026-11-03). The zone is on Cloudflare DNS.
- [x] R2 custom domain `data.pydocs.org` → `pydocs-content`, with CORS for `pydocs.org` and local dev (2026-11-03, `scripts/setup-cloudflare.sh`)
- [x] Worker custom domain `pydocs.org`: set in `wrangler.toml`, applied by the first deploy (live 2026-11-03)
- [ ] Cache Rule: hostname `data.pydocs.org` → eligible for cache, respect origin headers. Created in the dashboard because Wrangler's login can't write zone settings. The Worker writes objects with `Cache-Control: public, max-age=60`, so live refresh is at most a minute behind.
- [~] Add Worker secrets and GitHub Actions secrets. Set on 2026-11-03: `SESSION_SECRET` (random) and `ADMIN_GITHUB_IDS`. Still to do: `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` (once the OAuth apps exist), and the GitHub Actions secrets.
- [x] Spike (2026-11-03, throwaway Worker on workers.dev, since deleted): dotted paths, trailing slashes, `_idx` rewrite for `index` pages (see §4). `run_worker_first = ["/api/*", "/auth/*"]` sends only those to the Worker. `_redirects` 200 rewrites for `/u/*` and `/ex/*` work, `not_found_handling = "404-page"` works, and `env.ASSETS.fetch('/_data/symbols.txt')` works from the Worker. `_headers` doesn't apply to Worker responses, so the Worker sets its own headers.
- [x] Spike: R2 conditional put from a deployed Worker against real R2 (2026-11-03). `etagMatches` with the current ETag stores the write and a stale ETag returns `null`. Create-if-absent works with `etagDoesNotMatch: "*"` or `If-None-Match: *`. See §7.4.
- [x] Spike: Astro build time and output size for 12k pages (2026-11-03, local Apple Silicon, synthetic pages with dotted names): 11,842 pages in 2.6 s (4.2 s total), 47 MB, 11,860 files. `build.format: 'file'` writes `os.path.html` / `os.path/join.html` as planned. Timing on a GitHub runner will come from the first CI deploy.
- [x] Get ClojureDocs' compiled `app.css`, `bootstrap.min.css`, and `font-awesome.min.css` (2026-11-03). They use **Bootstrap 3.2.0** and **Font Awesome 4.1.0**; both files are byte-identical to the official releases. In `site/public/css` + `site/public/fonts`. EPL notice: `THIRD_PARTY_NOTICES.md` + `licenses/EPL-1.0.txt`.

### Phase 1: Reference data extractor
- [ ] `uv` project pinned to Python 3.15; download `objects.inv` and the docs HTML archive for the pinned release
- [ ] Inventory → symbol list (module, qualname, kind); map builtins → `builtins`
- [ ] Docs HTML parser: signatures (several `dt`s), versionadded/changed, deprecated, availability, impl-detail, anchor URL
- [ ] Introspection: docstring, fallback signature, source path and line → `github.com/python/cpython/blob/v3.15.x/...#L…`, async flags
- [ ] Fallback text for non-importable modules
- [ ] Chapters from `library/index.html`
- [ ] Doctest `>>>` snippet extraction per symbol, for seeding (Q4)
- [ ] Write `data/py-3.15/*` + stats report (counts, missing docs, fallbacks); snapshot tests on ~30 well-known symbols

### Phase 2: Static site with the same UI (no login yet)
- [~] Astro + Preact + TS skeleton; import the reference data. Skeleton done 2026-11-03 (Astro 7.4, Preact 11, TypeScript 7, Wrangler 4.156, Node 26 LTS). The `index-pages` integration moves `…/index.html` pages to `/_idx/` and writes the `_redirects` rewrites (§4). Next: import the reference data.
- [ ] `Main` layout: head/meta, desktop and mobile navbars, mobile slide-out menu, footer, staging banner, light/dark
- [ ] Port the CSS. Keep ClojureDocs' class names: `var-header`, `arglists`, `docstring`, `var-example`, `example-meta`, `sidenav`, `library-nav`, `ns-tree`, `dl-horizontal`, `quickref-*`, …
- [ ] Symbol page: header, badges, signatures, docstring + PSF line, sticky sidenav with counts, widget placeholders, recent pages (localStorage)
- [ ] Module page with sidebar tree (by chapter) and symbols grouped by letter with one-line doc
- [ ] `/library` and `/library/all`
- [ ] Home: static parts (headline, search, builtins by purpose, More modules, contribute teaser)
- [ ] Quickref: write `quickref.yaml` (original Python categories) + page with sticky TOC
- [ ] Search: index generator; autocomplete with every ClojureDocs shortcut; `/search` results page with pagination
- [ ] Prism with token colors mapped to ClojureDocs' `--syntax-*` variables
- [ ] `/examples-styleguide`, `/contribute`, 404, 500
- [ ] SEO: titles ("{name} - {module} | PyDocs - Community-Powered Python Documentation and Examples"), meta, OG/Twitter, canonical, JSON-LD, `sitemap.xml`, `robots.txt`, `opensearch.xml`
- [ ] Playwright screenshot diff of home, symbol, module, quickref, and search against the matching ClojureDocs pages (acceptance check for "exact same UI")

### Phase 3: GitHub auth
- [ ] `worker/auth.ts`: `/auth/login`, `/auth/callback`, `/auth/logout`: state cookie, code exchange, `/user`, account-age check, upsert `users/` and `logins/`
- [ ] Session sign/verify (WebCrypto HMAC) in `shared/`; `pd_user` UI cookie
- [ ] Navbar UserArea: "Log In" ↔ avatar + "Log Out"; return to the current page after login
- [ ] Local dev: `wrangler dev` with local R2 + the dev OAuth app

### Phase 4: Community content
- [ ] `shared/` zod schemas + ClojureDocs error messages
- [ ] R2 data layer: get/put with ETag retry, ULIDs, side writes, audit records
- [ ] API endpoints (§8) with the permission matrix (§7.3), limits, and the ban check
- [ ] Examples island: list, avatars (max 7 + "N more"), link/edit/delete + confirm, hash highlight, tabbed editor with Live Preview, CC0 notice, errors, spinner
- [ ] See-alsos island: list with doc excerpt, add with autocomplete, validation states ("This Var", "Already Exists", "Can't Add"), delete
- [ ] Notes island: markdown editor with live preview, edit/delete, sanitize
- [ ] Live refresh: fetch the symbol JSON after load and re-render if `updatedAt` changed
- [ ] `/ex/{id}` history page; `/u/{login}` user page
- [ ] Home: Example of the Day (from the bake) + Recently Updated (baked, then live)

### Phase 5: Build pipeline, bake, export, backup
- [ ] `deploy.yml`: on push + nightly cron → (reuse committed data) → R2 snapshot (rclone/S3, read-only key) → bake → Astro build → file-count check → `wrangler deploy`
- [ ] Bake: community content into HTML, example counts + see-alsos into the search index, "Still need an example" list, Example of the Day
- [ ] `rebuild-indexes.ts` nightly
- [ ] `export.json` (CC0) published on the site + committed to the `pydocs-data` repo (versioned backup)
- [ ] `extract.yml`: manual workflow to regenerate reference data for a new Python release, opened as a PR

### Phase 6: Moderation, hardening, tests
- [ ] Admin page (`/admin`, shell + Worker auth): recent activity with delete, ban/unban, audit viewer
- [ ] "report" link → prefilled GitHub issue
- [ ] Rate limiting (private bucket counters; use the Workers rate-limit binding instead if it's on the free plan ⚠️)
- [ ] `_headers` with CSP etc.
- [ ] Tests: Worker unit tests (permissions, validation, conflicts, injection), e2e flows (login → add/edit/delete example, see-also, note), XSS cases
- [ ] Load check: largest symbol doc stays under the 10 ms CPU limit

### Phase 7: Launch
- [ ] Seed examples from the docs' `>>>` snippets (`scripts/seed-doctests.ts`). Author: system user "python-docs", `source: "python-docs"`, shown with a "from python-docs" label. Idempotent, so it can be re-run.
- [ ] **Every symbol that has a doctest gets at least one seeded example.** Attach each `>>>` snippet to its symbol: snippets inside the symbol's `<dl>` block first, then snippets in module prose when the symbol they call is unambiguous. Symbols with no doctest get no seeded example (Q12). They show the normal "Log in to add an example" prompt and appear in the Contribute page's "Still need an example:" list. Done when a check reports 0 symbols that have a doctest but no example.
- [ ] Cloudflare Web Analytics
- [ ] Custom domain live; prod OAuth app verified
- [ ] Announce (r/Python, Python Discourse, HN, Mastodon)

### Phase 8: Later / nice-to-have
- [ ] "Run" button with Pyodide (lazy-loaded, ~10 MB on first click)
- [ ] CI job that runs every example in Pyodide and checks `# =>` results
- [ ] Concept pages
- [ ] Multi-version support (needs a different page strategy because of the 20k-file limit)
- [ ] Selected third-party packages
- [ ] `/dev/styleguide`

---

## 14. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Workers quota (100k req/day) used up | Writes and live refresh fail for the rest of the day | Static pages keep the baked content. Read path [A] keeps reads off the Worker. |
| 20k-file limit on static assets | Blocks adding versions or third-party libs | Guard in the build. Later: fold attributes into parent pages, or render some routes with the Worker. |
| Spam on an unmoderated wiki | Bad content | Rate limits, account age, bans, soft delete, audit log, backups, admin UI |
| R2 has no transactions or queries | Index drift | One doc per symbol, conditional writes, nightly index rebuild |
| Docs HTML structure changes between Python releases | Extractor breaks | Pin the version; snapshot tests; regenerate through a PR |
| Platform-only modules can't be imported on the Linux runner | Missing docstrings | Fall back to docs text |
| Empty site at launch | Low value at first | Seeding (Q4) |
| Dotted URLs on static assets | Broken routing | Spike passed (§4). Pages named `index` use the `_idx` rewrite. |
| EPL obligations for the ported UI | License compliance | Public repo + EPL notice (§17) |

---

## 15. Decision log

| Date | Decision | Status |
|---|---|---|
| 2026-11-01 | Host on Cloudflare Pages; community data in R2; GitHub login | Decided (by you) |
| 2026-11-01 | Static Astro site + Pages Functions for auth and writes (pure client-only is impossible, see §0) | Proposed |
| 2026-11-01 | Scope: Python stdlib, latest stable (3.15), one version (Q3) | Decided |
| 2026-11-01 | Use R2; add a payment method for activation, stay within the free tier (Q1) | Decided |
| 2026-11-01 | Own domain on Cloudflare DNS → read path [A]: public R2 on `data.<domain>` (Q2) | Decided |
| 2026-11-01 | Seed examples from the official docs' `>>>` snippets (0BSD), labeled "from python-docs" (Q4) | Decided |
| 2026-11-01 | Reuse ClojureDocs' compiled CSS and class names for UI parity | Proposed |
| 2026-11-01 | Contributions are CC0 (same as ClojureDocs) | Proposed |
| 2026-11-01 | Keep ClojureDocs' wiki-style editing (anyone logged in can edit any example) | Proposed |
| 2026-11-01 | Build in GitHub Actions; deploy from there with wrangler | Proposed |
| 2026-11-03 | One Worker with static assets replaces Pages + Pages Functions (Cloudflare now says "Start new projects with Workers"; same free limits) | Decided |
| 2026-11-03 | Every symbol that has a doctest gets at least one seeded example; no generated examples for the rest (Q12) | Decided (by you) |
| 2026-11-03 | Domain `pydocs.org` (bought through Cloudflare Registrar); Python pinned to 3.15.2; Git branch `master` | Decided |

---

## 16. Open questions

Each question has my default in **bold**. Q1–Q4 changed the architecture and are answered. The defaults for Q5–Q11 apply unless you say otherwise.

1. ✅ R2 needs a payment method on the account. → **Accepted. Use R2.**
2. ✅ Domain. → **`pydocs.org` (confirmed 2026-11-03). It goes on Cloudflare DNS; read path [A].** Bought through Cloudflare Registrar on 2026-11-03.
3. ✅ Scope. → **Stdlib only, Python 3.15 only.**
4. ✅ Seed examples from the docs' `>>>` snippets. → **Yes, labeled "from python-docs".**
5. Main doc block: the **docstring** (like ClojureDocs) plus an "Official docs ↗" link, or the richer docs.python.org text? → **Docstring + link.**
6. Branding: keep ClojureDocs' palette exactly and swap only the name, as a text wordmark with no Python logo? → **Yes.**
7. ✅ Public repo → **Yes.** Needed for EPL compliance, free Actions, and open data. Made public 2026-11-03.
8. ✅ Admins: → **`ertugrulcetin` (GitHub id 8271291)**, so `ADMIN_GITHUB_IDS=8271291`. (decided 2026-11-03)
9. Contribution license: → **CC0.**
10. Analytics: → **Cloudflare Web Analytics.**
11. When a symbol disappears in a newer Python release → **keep its community data in R2 and drop the page.**
12. ✅ Examples for symbols with no doctest. → **None. Only symbols that have a doctest get a seeded example. The rest wait for the community.** (decided 2026-11-03)

---

## 17. Licensing & attribution

- **Python docs text:** © Python Software Foundation, PSF License Version 2. Code in the docs is also under Zero-Clause BSD. Every symbol page shows the attribution line, like ClojureDocs' "© Rich Hickey" line.
- **ClojureDocs** (`nubank/clojuredocs`): Eclipse Public License 1.0. Our ported CSS and markup are derived works. Simplest compliance: publish the repo and license it under EPL-1.0 (EPL-2.0 is allowed as a later version), or keep the ported files under EPL in a clearly marked folder and the rest under MIT. *(Not legal advice.)*
- **Bootstrap 3:** MIT. **Font Awesome 4.7:** font under SIL OFL 1.1, CSS under MIT.
- **Community contributions:** CC0. The notice sits under every editor, as on ClojureDocs.
- **Name/brand:** "PyDocs" text wordmark. No ClojureDocs or Python logos. "Python" is used only in descriptive text, per PSF trademark policy.

---

## 18. ClojureDocs source map (where to look when building each piece)

| Piece | File in `nubank/clojuredocs` |
|---|---|
| Routes | `src/clj/clojuredocs/pages.clj`, `entry.clj`, `api/server.clj` |
| Layout, navbar, mobile nav, library nav tree | `src/clj/clojuredocs/pages/common.clj` |
| Var page, example history | `src/clj/clojuredocs/pages/vars.clj` |
| Home | `src/clj/clojuredocs/pages/intro.clj` |
| Namespace page | `src/clj/clojuredocs/pages/nss.clj` |
| Quickref | `src/clj/clojuredocs/pages/quickref.clj`, `quickref/static.clj` |
| User page | `src/clj/clojuredocs/pages/user.clj` |
| Contribute | `src/clj/clojuredocs/pages/contribute.clj` |
| Auth | `src/clj/clojuredocs/pages/gh_auth.clj`, `github.clj` |
| API rules and validation | `src/clj/clojuredocs/api/{common,examples,notes,see_alsos}.clj` |
| Widgets (UI states and copy) | `src/cljs/clojuredocs/{examples,notes,see_alsos}.cljs`, `mods/var_page.cljs` |
| Search and keyboard shortcuts | `src/cljs/clojuredocs/mods/search.cljs`, `main.cljs`, `src/clj/clojuredocs/search.clj` |
| Styles (colors, light/dark) | `src/clj/clojuredocs/css.clj` |
| Style guide text | `src/md/examples-styleguide.md` |
| Export | `src/clj/clojuredocs/export.clj` |
