# 05 — Capture & compare engine

`packages/engine` is a faithful TypeScript port of the prototype. Every rule below is
**normative** and covered by unit tests with fixtures taken from the prototype
(`prototype/*.js` at commit of 2026-11-19). Constants are exported so the UI can show defaults.

## 1. URL → filename (`urlToFilename`)  REQ-ENG-1

```
p = (pathname + search) without leading "/" ; if empty → "index"
name = p.replace(/[^a-z0-9._-]/gi, "_").replace(/_+/g, "_").substring(0, 200)
filename = name + ".png"
```
Must produce identical names to the prototype so legacy runs compare against new runs
(`https://stagen.com/about/people/` → `about_people_.png`). Collisions (two URLs → same name)
are detected when a run is created: the second URL gets suffix `__2`, `__3`… and a warning is
shown in the run detail.

## 2. Page vs file (`isFileUrl`)  REQ-ENG-2

Extension of URL path (`/\.([a-z0-9]{1,5})$/i`) in `FILE_EXTENSIONS`
(default list identical to `prototype/files.js`: pdf, doc, docx, xls, xlsx, xlsm, ppt, pptx, pps,
ppsx, odt, ods, odp, rtf, csv, txt, xml, json, zip, rar, 7z, gz, tar, jpg, jpeg, png, gif, webp,
svg, tif, tiff, bmp, ico, mp3, wav, m4a, mp4, mov, avi, webm, wmv, eps, ai, psd).
Project setting `file_extensions` overrides the list. `isFileScreenshotName` is kept for legacy
import (ignore `*.pdf.png` etc.).

## 3. Sitemap fetch  REQ-ENG-3

Port of `fetch-sitemap.js`:
1. GET `sitemap_index` (follow redirects, timeout 15 s, UA `VisualTestBot/1.0 (visual-regression-test)`, basic auth header if set).
2. Must return 200 and contain `<sitemapindex` or `<urlset`, else snapshot `failed`.
3. Sitemap index → fetch each child sitemap; failures on a child are recorded, not fatal.
4. Extract `<loc>` values, decode `&amp;`, dedupe, sort.
5. Merge `project_manual_urls`.
6. If `check_redirects`: HEAD each URL without following redirects (fallback GET on 405/501),
   concurrency 8. 3xx → `included=false`, `redirect_to=location`. Network error → kept, `http_status=null`.
   ≥ 400 → kept with status recorded (shown as warning).
7. Apply `ignore_rules` of type `url_pattern` with `applies_to in (capture, both)` → `included=false`.

Runs in `SitemapWorkflow` (the URL list can take minutes). Non-normative improvement allowed:
also accept nested sitemap indexes (index → index → urlset), max depth 3.

## 4. Capture of a page  REQ-ENG-4

For each (URL, viewport), using the `BrowserProvider` interface
(`BrowserRenderingProvider` in v1):

1. New page (or reused page from the same session): `setViewport({width, height, deviceScaleFactor, isMobile, hasTouch:isMobile})`;
   header `Accept-Language: en-US,en;q=0.9`; `page.authenticate(basicAuth)` if set.
2. `goto(url, { waitUntil: 'networkidle2', timeout: page_timeout_ms })`.
3. Inject `NORMALISE_CSS` (verbatim from prototype: hide cookie/consent/gdpr banners, `.cc-window`,
   `.pum-*`, OneTrust, pause animations/transitions, hide `video`) **+** project `extra_css`
   **+** `{ visibility: hidden !important }` for each `hide_selectors` entry and each enabled
   `selector` ignore rule matching the URL/viewport.
4. Lazy-load trigger: scroll by 600 px every 120 ms until `scrollY >= body.scrollHeight`, then
   back to top; wait for each `<img>` load/error with 5 s safety timeout per image.
5. `mouse.move(0,0)`, wait `settle_ms` (default 3000).
6. Full-page screenshot PNG. If document height > `max_page_height`, clip to
   `max_page_height` and mark item `truncated=true`.
7. PUT to R2 with `Content-Type: image/png`; record width, height, bytes and sha256 of the PNG bytes.

Failures: navigation timeout / crash → item `failed` with error message; the page/session is
discarded and a fresh one is used for the next item (as prototype).

## 5. Capture of a file  REQ-ENG-5

Port of `files.fingerprintUrl`: streamed GET (follow redirects, timeout 120 s, UA
`Mozilla/5.0 (visual-test fingerprint)`, basic auth), SHA-256 of body, 3 attempts with backoff
`attempt*2s` on 429/5xx/network error. Never throws: failure → `sha256 = "ERROR <reason>"`.
Store fingerprint text file (exact `formatFingerprint` format) in R2 **and** the parsed fields
in `run_items`. Files are captured once per run (not per viewport).

## 6. Comparison matrix  REQ-ENG-6

Given before run B and after run A:

* Key = (`kind`, `viewport_slug`, `filename`). Legacy run items have `viewport_slug='desktop'`.
* Only viewports present in **both** runs are compared; others are listed as "viewport not in
  before/after run" (info, not errors).
* For pages: in A only → `new`; in B only → `missing`; item failed in either run → `error`;
  both done → redirect check (§7) → pixel diff (§8).
* For files: compare `sha256`; equal → `unchanged`, different → `changed` (alert); missing/new as above.

## 7. Redirect detection at compare time  REQ-ENG-7

Port of `detectRedirect`: manual-follow up to 10 hops, timeout 15 s; if the final URL is a
different page (`samePage` ignores protocol, `www.`, trailing slash) → `redirect` with
`redirect_to`, not diffed. Network error → treat as no redirect. Skipped when
`check_redirects=false`. Result cached per comparison per URL (all viewports share it).

## 8. Pixel diff  REQ-ENG-8

Runs in the diff container. Port of `diffImages`:

1. Decode both PNGs (pngjs).
2. Pad both to `max(width) × max(height)` with white (`255`) — `padPng`.
3. Apply enabled `region` ignore rules for the URL/viewport: fill the rectangle with a solid
   colour (`#7f7f7f`) in **both** images before diffing.
4. `pixelmatch(a, b, diff, w, h, { threshold: diff_threshold, includeAA: false, diffColor: [255,0,128] })`.
5. `pct = diffPixels / (w*h) * 100`; `changed = pct >= change_threshold_pct`.
6. If changed → encode diff PNG, PUT to `diffs/<label>/<viewport>/<filename>`.

Golden tests: three fixture pairs from the prototype with known `diffPixels` must match exactly.

## 9. Static report export  REQ-ENG-9

`renderStaticReport(comparison, items, opts)` produces one self-contained HTML document with
the same sections as the prototype (`buildHtml`): top bar, summary chips, file fingerprint
section, changed pages sorted by `pct desc` with before/diff/after, redirected/new/missing lists.
Image `src` are absolute URLs under `r2_public_url`. Review status (approved/rejected/ignored)
is shown as a badge on each block. All dynamic text is HTML-escaped (the prototype did not
escape page URLs — fix).

## 10. Interfaces (TypeScript, normative names)

```ts
interface BrowserProvider { openSession(): Promise<BrowserSession> }
interface BrowserSession  { capture(job: CaptureJob): Promise<CaptureResult>; close(): Promise<void> }
interface ObjectStore     { put(bucket, key, body, contentType): Promise<void>; get(bucket, key): Promise<Uint8Array>;
                            list(bucket, prefix, opts?): AsyncIterable<{key:string,size:number}>; delete(bucket, keys:string[]): Promise<void> }
type Fetcher = typeof fetch
```
All engine functions receive these as parameters so they can be unit-tested with fakes.
