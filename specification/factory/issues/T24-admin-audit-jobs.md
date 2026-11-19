# T24 — Audit log and job health admin pages

**Milestone:** M5
**Depends on:** T13, T15

## Spec refs
- `specification/07-features.md F-ADMIN-2, F-ADMIN-3`
- `specification/06-jobs.md §8`
- `specification/10-non-functional.md NFR-18, NFR-27`

## Scope
- `/admin/audit` with filters + project-level audit tab for project admins.
- `/admin/jobs`: active runs/comparisons across projects, recent failures, DLQ message counts (CF API).

## Acceptance criteria
- [ ] Audit coverage test: every mutating route writes an entry (table-driven test).
- [ ] Job health shows a stuck run (no progress > 15 min) as warning.
- [ ] Definition of done in `AGENTS.md` satisfied.

## Out of scope
- Anything not listed in Scope; see `specification/12-delivery-plan.md` for the owning ticket.
