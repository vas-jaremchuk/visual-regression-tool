# T04 — Engine package: port prototype logic with parity tests

**Milestone:** M0
**Depends on:** T01

## Spec refs
- `docs/specification/05-engine.md §1–§9`
- `docs/specification/11-testing.md §1–§2`
- `docs/reference/prototype/*`

## Scope
Port to TypeScript (pure, dependency-injected):
- `urlToFilename` + collision suffixing; `isFileUrl`, `isFileScreenshotName`, `FILE_EXTENSIONS`.
- `fingerprintUrl(url, headers, fetcher)`, `formatFingerprint`, `parseFingerprint`, `fingerprintFilename`.
- Sitemap: `fetchSitemap(index, {fetcher, headers})`, `extractLocs`, `checkRedirects(urls, {concurrency:8})`.
- `NORMALISE_CSS`, `buildInjectedCss(project, rules, url, viewport)`, `lazyLoadScript`.
- `samePage`, `detectRedirect(url, fetcher)`.
- `diffImages(bufA, bufB, opts)` incl. `padPng` and region masking; `classifyPct`.
- `buildComparisonMatrix(beforeItems, afterItems)` per 05 §6.
- `renderStaticReport(...)` with HTML escaping.
- Ignore-rule matching (`glob` and `re:`).
Golden fixtures: generate expected filenames for all URLs from the prototype's sample sitemap list by executing the prototype function in `docs/reference/prototype`; commit JSON.

## Acceptance criteria
- [ ] Filename parity: 100 % match with golden JSON.
- [ ] Fingerprint format byte-identical with prototype `formatFingerprint` output for fixtures.
- [ ] Pixel diff counts identical to prototype implementation on `fixtures/png/*` pairs.
- [ ] Static report snapshot test; URL with `<script>` is escaped.
- [ ] Coverage ≥ 90 % lines for `packages/engine`.
- [ ] Definition of done in `AGENTS.md` satisfied.

## Out of scope
Browser/puppeteer code (T11), network wiring.
