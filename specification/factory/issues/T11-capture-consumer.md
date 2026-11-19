# T11 — Browser Rendering capture consumer and limiter

**Milestone:** M2
**Depends on:** T04, T05, T09

## Spec refs
- `docs/specification/05-engine.md §4–§5, §10`
- `docs/specification/06-jobs.md §3`
- `docs/specification/01-architecture.md ADR-2`

## Scope
- `BrowserRenderingProvider` implementing `BrowserProvider` with `@cloudflare/puppeteer` (session reuse).
- Capture of a page per 05 §4 (viewport options, auth, normalise CSS + hide selectors + selector rules, lazy load, settle, max height truncation, PNG sha256).
- File fingerprint per 05 §5 writing `.txt` + DB fields.
- Queue consumer for `vrt-capture` per 06 §3 incl. retries, idempotency, cancel handling.
- `ProjectLimiter` Durable Object (per-project + global semaphore).

## Acceptance criteria
- [ ] Consumer logic unit-tested with fake BrowserProvider/ObjectStore/Supabase.
- [ ] Item retried up to 3 attempts then `failed` with error.
- [ ] Done items are not reprocessed on redelivery.
- [ ] Manual verification documented in PR: real capture of fixture site via `wrangler dev --remote`.
- [ ] Definition of done in `AGENTS.md` satisfied.

## Out of scope
Workflow orchestration (T12).
