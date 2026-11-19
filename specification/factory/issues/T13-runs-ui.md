# T13 — Runs UI with realtime progress

**Milestone:** M2
**Depends on:** T12

## Spec refs
- `docs/specification/07-features.md F-RUN-1..4`
- `docs/specification/08-ui.md §3 Run detail`
- `docs/specification/06-jobs.md §7`

## Scope
- New run dialog (snapshot, viewports, scope, note, estimate, dry-run preview).
- Runs list (label, status, items, size, started by, duration, baseline marker).
- Run detail with segmented progress, ETA, items table (virtualised, thumbnails, lightbox), failures grouped, settings used, actions (cancel, retry, compare, set baseline, delete placeholder).
- Global active-job indicator in top bar.
- Supabase Realtime subscription on the run row.

## Acceptance criteria
- [ ] E2E with worker stub that advances items: progress updates without reload.
- [ ] Viewer sees runs but no action buttons; API returns 403 for viewer actions.
- [ ] Definition of done in `AGENTS.md` satisfied.

## Out of scope
- Anything not listed in Scope; see `docs/specification/12-delivery-plan.md` for the owning ticket.
