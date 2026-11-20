# Test fixtures

Fixtures used by unit, golden and end-to-end tests (see `specification/11-testing.md §2`).
Tests must use these instead of real customer URLs or credentials. They are added by the
tickets that first need them.

| Folder | Planned contents |
| ------ | ---------------- |
| `site/` | Tiny static website served by a local server in tests (`apps/worker/src/test/fixture-site.ts`; optional basic auth over the whole site): a sitemap index pointing to 2 child sitemaps, a redirect (`routes.json`), a 404, a PDF. `{{origin}}` in XML files is replaced with the server origin. Still to come with the capture tickets: lazy images, a cookie banner, an animation. |
| `site/v2/` | Variant of `site/` that changes one heading, one image and the PDF bytes, adds a page and removes a page. |
| `png/` | PNG pairs: identical, 1-pixel change, height difference, antialias-only change. |
| `prototype-env/` | Sample prototype `.env` files for legacy import tests. |
| `urls.txt` | ≥ 200 fixture URLs (fixture domains only) for filename parity. |
| `golden/` | Expected engine output generated from the prototype's own functions by `tools/generate-golden.mjs`: filenames, fingerprint text, pixel diff counts for `png/`, `extractLocs` and `samePage` cases. |
| `tools/` | One-off generator for `png/` and `golden/` (see its header for how to run it). |
