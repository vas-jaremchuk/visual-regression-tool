# 06 — Jobs & orchestration (Cloudflare)

> Cloudflare product limits (Browser Rendering concurrent sessions, Workflow step limits,
> Queue batch sizes, Container instance types) change over time. Implementers must check the
> current docs and record the values used in `apps/worker/LIMITS.md`. All limits below are
> **configurable constants**, not hard-coded assumptions.

## 1. Job types

| Job | Workflow | Queue | Heavy worker |
|-----|----------|-------|--------------|
| Sitemap fetch | `SitemapWorkflow(snapshotId)` | — | Worker (fetch only) |
| Capture run | `CaptureRunWorkflow(runId)` | `vrt-capture` | Browser Rendering |
| Comparison | `CompareWorkflow(comparisonId)` | `vrt-diff` | Diff container |
| Delete run / comparison | `DeleteWorkflow(entity, id)` | — | Worker (R2 batch delete) |
| Legacy import | `ImportWorkflow(projectId)` | — | Worker (R2 list + fingerprint parse) |

## 2. Capture run lifecycle  REQ-JOB-1

```
queued ──start──▶ running ──all items final──▶ completed | completed_with_errors
   │                 │
   └──cancel──▶ cancelled ◀──cancel──┘          (any) ──fatal──▶ failed
```

1. **prepare** step: load run + project, decrypt basic auth, `ensureBucket` (create if
   missing — CF REST, 409 tolerated), set `running`, `started_at`.
2. **enqueue** step: select `pending` items ordered by `kind, url`, group into batches of
   `CAPTURE_BATCH_SIZE` (default 10, pages of same viewport together), send to `vrt-capture`
   with message `{ runId, itemIds[] }`.
3. **wait** loop: `step.sleep(15s)` then `step.do('poll')` reading counts; exit when no
   `pending`/`processing` items or `cancel_requested_at` set. Hard timeout 6 h → remaining items
   `failed` with error `timeout`.
4. **finalise** step: compute status, `finished_at`, write audit, send `run_completed` /
   `run_failed` notifications.

Concurrency: the consumer's `max_concurrency` × sessions per message must not exceed
`capture_concurrency` per project and the account's Browser Rendering limit. Implement a
per-project semaphore in a Durable Object (`ProjectLimiter`) keyed by project id.

## 3. Capture consumer  REQ-JOB-2

For each message:
1. If run cancelled → ack, mark its items `skipped`.
2. Mark items `processing` (`attempts += 1`).
3. Acquire limiter slot; open (or reuse via `puppeteer.sessions()` / `connect`) a browser session.
4. Process items sequentially in the session; after each item update its row immediately
   (so progress is live and a crash loses at most one item).
5. On item error: `attempts < 3` → set back to `pending` and re-enqueue that single item with
   delay `attempts × 10 s`; else `failed`.
6. Release slot, close page; keep session alive for reuse when possible.

Idempotency: an item already `done` is skipped. R2 PUT overwrites — safe.

## 4. Resume / retry  REQ-JOB-3

Replaces the prototype checkpoint file.
* **Retry failed**: sets `failed` items of a finished run back to `pending`, run → `running`,
  starts a new Workflow instance for the same run id.
* A Workflow crash resumes automatically (Workflows persist step results).
* **Cancel**: sets `cancel_requested_at`; consumer stops at next item; Workflow terminates;
  finished items are kept and the run can still be compared.

## 5. Comparison lifecycle  REQ-JOB-4

1. **prepare**: validate both runs `completed*` and same project; freeze settings + enabled
   ignore rules into `comparisons.settings`; delete old `comparison_items` if re-running.
2. **matrix**: build per §05-6 and insert all items with preliminary statuses; pairs to diff
   get status `pending`.
3. **files**: compare fingerprints in-step (no I/O beyond DB).
4. **redirects**: run redirect detection for unique URLs of pairs (concurrency 8) unless disabled.
5. **enqueue** diff pairs to `vrt-diff` in batches of 5.
6. **wait** like capture.
7. **auto-review**: apply `review_memory` matches (§07 F-REVIEW-6); ignore rules by URL with
   `applies_to in (compare,both)` → `review='ignored'` automatically.
8. **export** static report if `r2_public_url` set.
9. **finalise** counts + notifications (`comparison_changed` if changed items with
   `review in (pending, rejected)` > 0 or file fingerprints changed; else `comparison_clean`).

## 6. Diff consumer & container  REQ-JOB-5

Consumer posts `{ bucket, beforeKey, afterKey, diffKey, thresholds, regions[] }` to the
container `POST /diff`; container returns
`{ changed, diffPct, diffPixels, totalPixels, beforeDims, afterDims }`. Container reads/writes R2
itself with S3 credentials (avoids shipping 50 MB bodies through the Worker). Container has
`GET /health`. Failures retried 3× then item `error`.

## 7. Progress & realtime  REQ-JOB-6

* Worker calls `refresh_run_counts(run_id)` / `refresh_comparison_counts(id)` after each batch.
* Web subscribes to Supabase Realtime `postgres_changes` on the single `runs` / `comparisons`
  row (not on items — too chatty); item tables are re-fetched on demand (paged).
* ETA = remaining items × moving average item duration ÷ effective concurrency.

## 8. Observability

* Every job log line is JSON with `projectId`, `runId|comparisonId`, `itemId`, `step`.
* Workers Logs enabled; failed queue messages go to DLQs and appear on an admin "Job health" panel
  (count of DLQ messages via CF API).
