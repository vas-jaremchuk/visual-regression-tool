# T22 — Storage page and delete workflow

**Milestone:** M5
**Depends on:** T12, T15

## Spec refs
- `docs/specification/07-features.md F-STORAGE-1..5, F-RUN-4, F-PROJ-6`
- `docs/specification/06-jobs.md §1`

## Scope
- Storage workflow (list bucket, group by prefix, cache result), project storage page, admin global storage.
- DeleteWorkflow for run (cascade comparisons, with preview of what will be deleted), comparison, project (optional R2 cleanup); `delete_failed` state + retry.
- Retention hint (keep last N) shown as proposal list only.

## Acceptance criteria
- [ ] Deleting a run removes `screenshots/<label>/`, dependent `diffs/`/`reports/` and DB rows.
- [ ] Baseline run cannot be deleted until baseline changes.
- [ ] Storage numbers match R2 listing for fixture bucket.
- [ ] Definition of done in `AGENTS.md` satisfied.

## Out of scope
- Anything not listed in Scope; see `docs/specification/12-delivery-plan.md` for the owning ticket.
