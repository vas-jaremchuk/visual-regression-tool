# 07 — Functional requirements

Format: `ID — requirement. Acceptance: …`. "Editor+" = editor, project admin, platform admin.

## F-PROJ — Projects

* **F-PROJ-1** — Platform admin creates a project with name, sitemap index, R2 bucket (required), public URL, basic auth (optional). Slug auto-generated, unique. Default viewport `desktop 1280×900` created. *Acceptance:* project appears in list; creator is project admin.
* **F-PROJ-2** — Project list shows for each accessible project: name, last run (label, status), last comparison (changed count, pending reviews), baseline label. Sorted by last activity.
* **F-PROJ-3** — Project admin edits settings (03 §6). Changes are audited (old/new values, secrets redacted). Settings changes never alter finished runs (runs keep a frozen `settings` copy).
* **F-PROJ-4** — Import from prototype `.env`: paste text → parsed preview → create project. Unknown keys ignored, `CF_*` ignored with a note.
* **F-PROJ-5** — *Check bucket* button: verifies the bucket exists (offers to create it) and the S3 credentials can write/read/delete a probe object. *Test public URL*: fetches the probe via `r2_public_url`.
* **F-PROJ-6** — Archive (read-only, hidden from default list) and delete (platform admin; optional R2 cleanup via DeleteWorkflow).

## F-SITEMAP — URL list

* **F-SITEMAP-1** — Editor+ clicks *Fetch sitemap* → SitemapWorkflow; progress (child sitemaps fetched, URLs checked) visible live.
* **F-SITEMAP-2** — Snapshot view: table of URLs with kind (page/file), HTTP status, redirect target, included flag; filters (included/excluded/redirects/errors/files); search; counts. Export as `.txt` (one URL per line, prototype compatible).
* **F-SITEMAP-3** — Diff against previous snapshot: added / removed URLs.
* **F-SITEMAP-4** — Manual URLs: add/remove URLs not in the sitemap; they're merged into each snapshot (`source=manual`).
* **F-SITEMAP-5** — A run always uses a specific snapshot; *New run* defaults to the latest completed snapshot and warns if it is older than 7 days.

## F-RUN — Capture runs

* **F-RUN-1** — *New run* dialog: snapshot, viewports (multi-select, default all enabled), scope (all included URLs | only pages | only files | custom subset: paste URLs or pick from table, or "random sample N"), note. Shows estimate (items, ≈ duration). *Dry run* lists items without capturing (prototype `--dry-run`).
* **F-RUN-2** — Run label = UTC timestamp `YYYY-MM-DD_HH-MM-SS`; unique per project (append `-2` on collision).
* **F-RUN-3** — Run detail: status, progress bar per viewport, counts (done/failed/pending), ETA, started by, duration; items table with thumbnail, URL, viewport, dims, truncated flag, status, error; filters; open full screenshot in a lightbox.
* **F-RUN-4** — Actions: cancel (running), retry failed (finished with errors), compare with baseline, compare with…, set as baseline, delete (project admin; cascades comparisons that use it after confirmation listing them — prototype `delete-set.js` semantics).
* **F-RUN-5** — Only one active (queued/running) capture run per project; second request returns 409 with link to the active run.
* **F-RUN-6** — Legacy import: project admin clicks *Import existing runs* → lists `screenshots/<ts>/` prefixes in the bucket not yet in DB → select → creates `runs` (is_legacy) and `run_items` from object listing (+ parse `.txt` fingerprints). URL reconstructed from the latest sitemap snapshot by filename when possible.

## F-CMP — Comparisons

* **F-CMP-1** — Start a comparison by picking before/after runs (before must be older); default before = baseline, after = latest completed run. Re-running the same pair replaces results after confirmation.
* **F-CMP-2** — Report page (see 08 §Report): summary chips identical in meaning to the prototype (compared, changed, unchanged, new, missing, redirected, files changed/total) per viewport and total.
* **F-CMP-3** — Changed items list sorted by diff % desc, with severity colour (> 5 % high, > 1 % mid, else low — prototype bands), filter by viewport, status, review status, URL search.
* **F-CMP-4** — Item viewer modes: side-by-side (before / diff / after, prototype layout), **slider** (drag to reveal before vs after), **overlay** (onion skin with opacity), **diff only**. Synchronised scroll and zoom (fit width / 100 %). Keyboard: `j/k` next/prev, `a` approve, `r` reject, `i` ignore, `1-4` modes.
* **F-CMP-5** — Files section: changed fingerprints with before/after sha256 and sizes, new/missing files, all-match banner.
* **F-CMP-6** — Lists of redirected (with target), new and missing pages.
* **F-CMP-7** — Comparisons list per project with pair, status, counts, review progress (e.g. "12/40 reviewed").
* **F-CMP-8** — Download static HTML (same as R2 export) even without public URL.

## F-REVIEW — Approve / ignore

* **F-REVIEW-1** — Each `changed` item has review status `pending` (default), `approved` (expected change), `rejected` (bug), `ignored` (noise). Optional note. Stored with user + time; audited.
* **F-REVIEW-2** — Bulk actions on filtered selection (e.g. approve all < 0.5 %).
* **F-REVIEW-3** — From an item: *Ignore this URL* (creates `url_pattern` rule, prefilled exact URL), *Hide element* (creates `selector` rule — user types selector), *Ignore region* (draw a rectangle on the after image → `region` rule for this URL pattern + viewport). New rules apply to future comparisons; a *Re-diff with current rules* action re-runs the comparison.
* **F-REVIEW-4** — Comparison is "fully reviewed" when no `pending` changed items remain; UI shows a banner and offers *Promote after-run to baseline*.
* **F-REVIEW-5** — Baseline: one per project; set from run detail or comparison; history kept in audit log.
* **F-REVIEW-6** — Review memory: when an item is approved/ignored, store (`url`, `viewport`, sha256 of after PNG). In later comparisons, a changed item whose after-PNG hash matches a remembered approved/ignored hash for the same URL+viewport is auto-set with note "auto: same as approved in <label>". (Requires capture to store PNG sha256 in `run_items.sha256` for pages too.)

## F-IGNORE — Ignore rules

* **F-IGNORE-1** — Ignore rules page: table with type, pattern/selector/region preview, viewport, applies_to, enabled toggle, reason, author; create/edit/delete (editor+).
* **F-IGNORE-2** — Pattern tester: input a URL → shows which rules match.
* **F-IGNORE-3** — Rules are snapshot into runs/comparisons settings so history is reproducible.

## F-VIEWPORT — Multiple viewports

* **F-VIEWPORT-1** — Project admin manages viewports (03 §6). Slug immutable once used in a run.
* **F-VIEWPORT-2** — Runs capture all selected viewports; files only once.
* **F-VIEWPORT-3** — Reports group/filter by viewport; summary per viewport.

## F-NOTIFY — Notifications

* **F-NOTIFY-1** — Project admin adds channels: email (any address; default = all project members toggle) or Slack incoming webhook (URL encrypted). Choose events: `comparison_changed`, `comparison_clean`, `run_completed`, `run_failed`.
* **F-NOTIFY-2** — *Send test* button per channel.
* **F-NOTIFY-3** — Message content: project, pair labels, counts (changed / new / missing / redirect / files changed), top 5 changed URLs with %, link to report (`APP_URL/p/<slug>/comparisons/<id>`). Slack uses Block Kit; email is HTML + text.
* **F-NOTIFY-4** — Delivery recorded in `notification_log`; failures retried 3× and visible in channel settings.
* **F-NOTIFY-5** — Users can mute a project for themselves (personal preference) for email channels.

## F-STORAGE — Storage management

* **F-STORAGE-1** — Project storage page: total bytes and object count by prefix (`screenshots`, `diffs`, `reports`, other) — port of `storage.js`, with bar vs 10 GB free tier (constant, configurable). Computed by a Workflow, cached in DB, *Refresh* button.
* **F-STORAGE-2** — Per-run size shown in runs list (sum of `run_items.bytes`).
* **F-STORAGE-3** — Delete run / comparison (cascade per F-RUN-4). Deletion of R2 objects via DeleteWorkflow using batch delete; DB rows removed after R2 succeeds; partial failure keeps the row with status `delete_failed` and retry.
* **F-STORAGE-4** — Platform admin global storage view across buckets.
* **F-STORAGE-5** (should) — Retention setting: keep last N non-baseline runs; older ones are proposed for deletion (never automatic in v1).

## F-ADMIN — Administration

* **F-ADMIN-1** — Users page (platform admin): list, invite, disable/enable, promote/demote platform admin, see project memberships.
* **F-ADMIN-2** — Audit log page with filters (project, actor, action, date).
* **F-ADMIN-3** — Job health: active runs/comparisons across projects, DLQ counts, last errors.
