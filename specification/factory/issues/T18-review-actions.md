# T18 — Review actions, bulk review, baseline and keyboard shortcuts

**Milestone:** M4
**Depends on:** T16

## Spec refs
- `specification/07-features.md F-REVIEW-1, -2, -4, -5`
- `specification/09-api.md review endpoint, RPCs`
- `specification/08-ui.md §3`

## Scope
- Approve/reject/ignore with note on item; bulk on filtered selection; `review_items` RPC; review counts live.
- Keyboard: j/k, a, r, i, 1–4.
- Fully reviewed banner + promote after-run to baseline; baseline badge throughout UI.
- Comparisons list shows review progress.

## Acceptance criteria
- [ ] Viewer cannot review (RLS + 403).
- [ ] Bulk approve of 200 items in < 2 s.
- [ ] Audit entries per review action (bulk = one entry with ids).
- [ ] Definition of done in `AGENTS.md` satisfied.

## Out of scope
- Anything not listed in Scope; see `specification/12-delivery-plan.md` for the owning ticket.
