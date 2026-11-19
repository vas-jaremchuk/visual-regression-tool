# T20 — Review memory (auto-approve repeated changes)

**Milestone:** M4
**Depends on:** T18

## Spec refs
- `docs/specification/07-features.md F-REVIEW-6`
- `docs/specification/02-data-model.md review_memory`

## Scope
- `review_items` writes `review_memory` (url, viewport, after sha256, decision).
- Compare workflow auto-review step applies matches with note `auto: same as approved in <label>`.
- UI marks auto-reviewed items and allows overriding.

## Acceptance criteria
- [ ] Approving a change then comparing baseline vs an identical later run auto-approves it.
- [ ] Different after-hash is not auto-approved.
- [ ] Definition of done in `AGENTS.md` satisfied.

## Out of scope
- Anything not listed in Scope; see `docs/specification/12-delivery-plan.md` for the owning ticket.
