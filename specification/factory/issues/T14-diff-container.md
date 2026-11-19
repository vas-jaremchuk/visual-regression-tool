# T14 — Diff container service

**Milestone:** M3
**Depends on:** T04, T05

## Spec refs
- `docs/specification/05-engine.md §8`
- `docs/specification/06-jobs.md §6`
- `docs/specification/09-api.md §4`
- `docs/specification/01-architecture.md ADR-2`

## Scope
- Node HTTP server (`/health`, `POST /diff` bearer-auth) using engine `diffImages` and storage `ObjectStore`.
- Reads PNGs from R2, masks regions, diffs, uploads diff when changed, returns metrics + after sha256.
- Dockerfile (slim Node), memory sized ≥ 1 GiB; Container class `DiffContainer` binding in worker.
- Guard: images > `max_page_height` or > 64 MP rejected with clear error.

## Acceptance criteria
- [ ] Fixture pairs produce exact pixel counts (same as engine golden tests).
- [ ] Unauthorized request → 401.
- [ ] Diff PNG not uploaded when unchanged.
- [ ] Definition of done in `AGENTS.md` satisfied.

## Out of scope
- Anything not listed in Scope; see `docs/specification/12-delivery-plan.md` for the owning ticket.
