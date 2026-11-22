# Test fixtures

Fixtures used by unit, golden and end-to-end tests (see `specification/11-testing.md §2`).
Tests must use these instead of real customer URLs or credentials. They are added by the
tickets that first need them.

| Folder | Planned contents |
| ------ | ---------------- |
| `site/` | Tiny static website served by a local server in tests (`apps/worker/src/test/fixture-site.ts`; optional basic auth over the whole site) and, on staging, by the fixture site Worker (`apps/worker/wrangler.fixture-site.jsonc`, see `docs/runbook.md`): a sitemap index pointing to 2 child sitemaps, a redirect (`routes.json`), a 404, a PDF, an image on the about page. `{{origin}}` in XML files is replaced with the server origin. Not yet: lazy images, a cookie banner, an animation. |
| `site/v2/` | Variant of `site/` served under the same URLs (`version: 'v2'` / `SITE_VERSION=v2`): changes the home heading, the about image (`img/team.svg`) and the PDF bytes, adds `/contact/` and removes `/blog/post-1/`. |
| `png/` | PNG pairs: identical, 1-pixel change, height difference, antialias-only change. |
| `legacy-bucket/` | R2 bucket in prototype layout for legacy import tests (F-RUN-6): two prototype runs (`screenshots/<ts>/<filename>.png` and `.txt` fingerprints, including a legacy screenshot of a PDF link and a page missing from the sitemap) and one run in the new layout that must not be listed. |
| `prototype-env/` | Sample prototype `.env` files for legacy import tests. |
| `urls.txt` | ≥ 200 fixture URLs (fixture domains only) for filename parity. |
| `golden/` | Expected engine output generated from the prototype's own functions by `tools/generate-golden.mjs`: filenames, fingerprint text, pixel diff counts for `png/`, `extractLocs` and `samePage` cases. |
| `tools/` | One-off generator for `png/` and `golden/` (see its header for how to run it). |
