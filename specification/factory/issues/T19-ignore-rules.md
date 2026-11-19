# T19 — Ignore rules end-to-end

**Milestone:** M4
**Depends on:** T18

## Spec refs
- `docs/specification/02-data-model.md ignore_rules`
- `docs/specification/05-engine.md §3 step 7, §4 step 3, §8 step 3`
- `docs/specification/07-features.md F-IGNORE-1..3, F-REVIEW-3`
- `docs/specification/06-jobs.md §5 step 7`

## Scope
- Ignore rules page with CRUD, enable toggle, pattern tester.
- Shortcuts from item viewer: ignore URL, hide element (selector), draw region (pixel coords, viewport-scoped).
- Rules applied in sitemap/run creation (url capture), capture (selectors), diff (regions), compare auto-ignore (url compare).
- `POST /api/comparisons/:id/rediff`.

## Acceptance criteria
- [ ] Region rule makes a previously changed fixture item unchanged after re-diff.
- [ ] Selector rule hides element in next capture (unit test on injected CSS + e2e with fake).
- [ ] Rules snapshot into run/comparison settings.
- [ ] Definition of done in `AGENTS.md` satisfied.

## Out of scope
- Anything not listed in Scope; see `docs/specification/12-delivery-plan.md` for the owning ticket.
