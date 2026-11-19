# T05 — Storage package: R2 S3 client and bucket admin

**Milestone:** M0
**Depends on:** T03

## Spec refs
- `docs/specification/01-architecture.md ADR-3`
- `docs/specification/05-engine.md §10 ObjectStore`
- `docs/specification/10-non-functional.md NFR-9`

## Scope
- `ObjectStore` implementation over R2 S3 endpoint with `aws4fetch`: put, get, head, list (paginated async iterator with prefix/delimiter), batch delete (DeleteObjects ≤ 1000 keys), presigned GET URL.
- Retries per NFR-9 for transient statuses and network errors.
- `BucketAdmin` over Cloudflare REST API: `exists`, `ensure` (409 tolerated), `list`.
- In-memory `FakeObjectStore` for tests (exported from `/testing`).

## Acceptance criteria
- [ ] Unit tests with mocked fetch cover signing headers, pagination, retry/backoff, batch delete chunking.
- [ ] Works in Workers runtime and Node (no Node-only APIs).
- [ ] Definition of done in `AGENTS.md` satisfied.

## Out of scope
- Anything not listed in Scope; see `docs/specification/12-delivery-plan.md` for the owning ticket.
