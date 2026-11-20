# Test fixtures

Fixtures used by unit, golden and end-to-end tests (see `specification/11-testing.md §2`).
Tests must use these instead of real customer URLs or credentials. They are added by the
tickets that first need them.

| Folder | Planned contents |
| ------ | ---------------- |
| `site/` | Tiny static website served by a local server in tests: a sitemap index pointing to 2 child sitemaps, pages with lazy images, a cookie banner, an animation, a redirect, a 404, a PDF and a page protected by basic auth. |
| `site/v2/` | Variant of `site/` that changes one heading, one image and the PDF bytes, adds a page and removes a page. |
| `png/` | PNG pairs: identical, 1-pixel change, height difference, antialias-only change. |
| `prototype-env/` | Sample prototype `.env` files for legacy import tests. |
| `urls.txt` | ≥ 200 fixture URLs (fixture domains only) for filename parity. |
| `golden/` | Expected engine output generated from the prototype's own functions by `tools/generate-golden.mjs`: filenames, fingerprint text, pixel diff counts for `png/`, `extractLocs` and `samePage` cases. |
| `tools/` | One-off generator for `png/` and `golden/` (see its header for how to run it). |
