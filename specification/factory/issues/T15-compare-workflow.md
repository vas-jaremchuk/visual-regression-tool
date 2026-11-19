# T15 — Compare workflow, diff consumer, files and redirects

**Milestone:** M3
**Depends on:** T12, T14

## Spec refs
- `docs/specification/05-engine.md §6–§7`
- `docs/specification/06-jobs.md §5–§6`
- `docs/specification/07-features.md F-CMP-1`
- `docs/specification/09-api.md`

## Scope
- `POST /api/projects/:id/comparisons` (validation, replace confirmation) → `CompareWorkflow` steps 1–9 of 06 §5 (export step calls engine renderer only if `r2_public_url`; notifications step calls a no-op notifier interface implemented in T21).
- `vrt-diff` consumer calling the container, retries, item updates.
- Counts per viewport stored in `counts`.
- Comparisons list page (F-CMP-7) basic version.

## Acceptance criteria
- [ ] Fixture v1→v2 produces: changed (heading, image), new, missing, redirect, file changed; counts correct.
- [ ] Viewport only in one run is reported as info, not error.
- [ ] Re-running the same pair replaces items.
- [ ] Legacy-style run items (no viewport) compare against `desktop`.
- [ ] Definition of done in `AGENTS.md` satisfied.

## Out of scope
Report UI (T16).
