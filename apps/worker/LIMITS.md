# Cloudflare limits used by the worker

Cloudflare product limits change over time (specification/06-jobs.md note). This file records the
values the worker is designed against, checked on **2026-11-19** against the Cloudflare docs. Our
own knobs are configurable constants in `packages/shared/src/constants.ts` and `wrangler.jsonc`;
re-check this table before raising any of them.

## Browser Rendering (`BROWSER`)

Source: <https://developers.cloudflare.com/browser-rendering/limits/>

| Limit                  | Workers Paid                        | Workers Free         | Used by                                                        |
| ---------------------- | ----------------------------------- | -------------------- | -------------------------------------------------------------- |
| Concurrent browsers    | 200 per account                     | 3 per account        | per-project `capture_concurrency` (max 10) + `ProjectLimiter`  |
| New browser instances  | 3 per second                        | 1 every 20 s         | session reuse (06 §3)                                          |
| Browser idle timeout   | 60 s default, `keep_alive` ≤ 20 min | same                 | `BROWSER_SESSION_KEEP_ALIVE_MS` = 60 s                         |
| Browser hours          | no limit (billed)                   | 10 min per day       | Free plan is not usable for real runs                          |

## Workflows (`CAPTURE_RUN`, `COMPARE_RUN`, `SITEMAP_FETCH`)

Source: <https://developers.cloudflare.com/workflows/reference/limits/>

| Limit                       | Workers Paid                               | Used by                                              |
| --------------------------- | ------------------------------------------ | ---------------------------------------------------- |
| Steps per instance          | 10,000 default (configurable to 25,000)    | poll loop every `JOB_POLL_INTERVAL_MS` = 15 s; `RUN_HARD_TIMEOUT_MS` = 6 h stays far below |
| CPU time per step           | 30 s default (`limits.cpu_ms` up to 5 min) | steps do I/O only, no heavy CPU                      |
| Step wall-clock duration    | unlimited (I/O wait is free)               |                                                      |
| Step result size            | 1 MiB                                      | steps return ids and counts, never URL lists         |
| Persisted state / instance  | 1 GB                                       |                                                      |
| Event payload size          | 1 MiB                                      | payloads are ids only (09 §2)                        |
| Concurrent instances        | 50,000 per account                         |                                                      |
| Instance creation rate      | 300/s per account, 100/s per Workflow      | `JOB_START_RATE_LIMIT_PER_MINUTE` = 10 per user      |
| Completed-state retention   | 7 days default (up to 30 days)             | status is mirrored to Supabase, not read back later  |

## Queues (`CAPTURE_QUEUE` → `vrt-capture`, `DIFF_QUEUE` → `vrt-diff`)

Source: <https://developers.cloudflare.com/queues/platform/limits/>

| Limit                   | Value                                      | Used by                                                   |
| ----------------------- | ------------------------------------------ | --------------------------------------------------------- |
| Message size            | 128 KB                                     | messages carry ids only (09 §3)                           |
| Consumer batch size     | 100 messages                               | `max_batch_size` 10 = `CAPTURE_BATCH_SIZE`, 5 = `DIFF_BATCH_SIZE` |
| `sendBatch`             | 100 messages or 256 KB                     |                                                           |
| Max retries             | 100                                        | `max_retries` 3 = `ITEM_MAX_ATTEMPTS` / `DIFF_MAX_ATTEMPTS`, then DLQ |
| Consumer wall time      | 15 min per invocation                      | 10 pages × `pageTimeoutMs` (max 180 s) must fit           |
| Consumer CPU time       | 30 s default (`limits.cpu_ms` up to 5 min) |                                                           |
| Message retention       | up to 14 days (24 h on Free)               |                                                           |
| Delivery / retry delay  | ≤ 24 h                                     | `ITEM_RETRY_DELAY_MS` × attempts                          |
| Throughput per queue    | 5,000 messages/s                           |                                                           |

## Containers (`DIFF_CONTAINER` → `DiffContainer`)

Source: <https://developers.cloudflare.com/containers/platform-details/limits/>

| Limit                    | Value                                       | Used by                                    |
| ------------------------ | ------------------------------------------- | ------------------------------------------ |
| Instance type            | `standard-1`: 1/2 vCPU, 4 GiB RAM, 8 GB disk | ≥ 1 GiB required for full-page diffs (ADR-2) |
| Largest instance         | 4 vCPU, 12 GiB RAM, 20 GB disk               |                                            |
| Account concurrency      | 60 TiB memory, 15,000 vCPU                   | `max_instances` = 5 in `wrangler.jsonc`    |
| Image storage            | 50 GB per account                            |                                            |
| Outbound request body    | 100 MiB                                      | PNGs are streamed to/from R2 by the container |

## Workers runtime

| Limit           | Value  | Consequence                                                         |
| --------------- | ------ | ------------------------------------------------------------------- |
| Memory per isolate | 128 MB | the worker never decodes PNGs; screenshots stream to R2 (ADR-2) |
