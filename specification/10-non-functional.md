# 10 — Non-functional requirements

## Performance & scale (targets)

| ID | Requirement |
|----|-------------|
| NFR-1 | Support ≥ 10 projects, ≥ 20 users, sites up to 2 000 URLs × 3 viewports per run. |
| NFR-2 | 800 URLs × 1 viewport capture completes in ≤ 45 min at `capture_concurrency=4` (prototype: concurrency 2). |
| NFR-3 | Comparison of 800 pairs completes in ≤ 20 min. |
| NFR-4 | Report page: first contentful render ≤ 2 s with 1 000 items (list virtualised, items paged 100 at a time). |
| NFR-5 | Web API p95 ≤ 500 ms for CRUD; job start endpoints ≤ 2 s. |
| NFR-6 | Concurrent runs across different projects are allowed; total browser sessions capped by account limit via `ProjectLimiter` + global limiter. |

## Reliability

* NFR-7 — No single URL failure fails a run; runs end `completed_with_errors`.
* NFR-8 — Worker/Workflow restarts lose at most the in-flight item; everything resumes (replaces checkpoint).
* NFR-9 — All R2 operations retry transient errors (429, 5xx, 520–524, network) with backoff `attempt × 2 s`, max 5 attempts (prototype `upload`).
* NFR-10 — Job endpoints are idempotent on entity id (starting an already-running run returns its workflow id).

## Security

* NFR-11 — RLS on every table; CI test enumerates tables and fails if any has RLS disabled.
* NFR-12 — Secrets (basic auth, Slack webhooks) encrypted at rest; never logged; never sent to the browser.
* NFR-13 — Service role key only in worker/container and server-only modules (`import 'server-only'`).
* NFR-14 — SSRF guard: sitemap/capture/fingerprint fetches only to `http(s)` URLs whose host is not private/loopback/link-local (resolve and check), except allow-listed via env for local dev.
* NFR-15 — All user-supplied strings rendered in HTML exports are escaped; CSP on web app.
* NFR-16 — Share tokens: 256-bit random, stored hashed, constant-time compare, expirable.
* NFR-17 — Rate limits: job start endpoints 10/min per user; login per Supabase defaults.
* NFR-18 — Audit log for every mutating action listed in 02 §audit_log.

## Cost

* NFR-19 — Storage per run reported; prototype copied before/after images into `reports/`; new layout must not duplicate images (≈ 3× saving on changed pages).
* NFR-20 — Diff container scales to zero when idle.
* NFR-21 — Browser sessions closed when queue is drained; idle keep-alive ≤ 60 s.

## Maintainability

* NFR-22 — TypeScript strict, no `any` in exported APIs; shared contracts in `packages/shared`.
* NFR-23 — `packages/engine` ≥ 90 % line coverage; other packages ≥ 70 %.
* NFR-24 — Every migration reversible or documented as forward-only; `supabase db reset` works from scratch with seed.
* NFR-25 — Conventional commits; each PR references REQ/F IDs it implements.

## Observability

* NFR-26 — Structured JSON logs (06 §8); Vercel + Workers logs; errors reported to Sentry (optional, env `SENTRY_DSN`).
* NFR-27 — Admin job health page (F-ADMIN-3).

## Compatibility

* NFR-28 — Legacy prototype R2 data readable and comparable (filename scheme, fingerprint format).
* NFR-29 — Latest two versions of Chrome, Firefox, Safari, Edge for the web UI.
