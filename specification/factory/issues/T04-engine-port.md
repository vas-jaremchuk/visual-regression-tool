# T04 — Engine package: port prototype logic with parity tests

**Milestone:** M0
**Depends on:** T01

## Spec refs
- `specification/05-engine.md §1–§9`
- `specification/11-testing.md §1–§2`
- `prototype/*.js`

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
Golden fixtures: commit `fixtures/urls.txt` with ≥ 200 URLs (root, nested paths, trailing slashes, query strings, encoded/unicode chars, > 200-char paths, file links) and generate the expected filenames by executing the prototype logic from `prototype/take-screenshots.js` / `prototype/files.js` (copy the pure functions into a one-off script; do not modify `prototype/`); commit the resulting JSON.

## Acceptance criteria
- [ ] Filename parity: 100 % match with golden JSON.
- [ ] Fingerprint format byte-identical with prototype `formatFingerprint` output for fixtures.
- [ ] Pixel diff counts identical to prototype implementation on `fixtures/png/*` pairs.
- [ ] Static report snapshot test; URL with `<script>` is escaped.
- [ ] Coverage ≥ 90 % lines for `packages/engine`.
- [ ] Definition of done in `AGENTS.md` satisfied.

## Out of scope
Browser/puppeteer code (T11), network wiring.
