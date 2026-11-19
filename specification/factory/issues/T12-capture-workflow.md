# T12 — Capture run workflow, run API, cancel and retry

**Milestone:** M2
**Depends on:** T10, T11

## Spec refs
- `docs/specification/06-jobs.md §2, §4`
- `docs/specification/07-features.md F-RUN-1, F-RUN-2, F-RUN-4, F-RUN-5`
- `docs/specification/09-api.md §1–§2`

## Scope
- `POST /api/projects/:id/runs` (incl. dry run, scopes, sample, viewports, collision-safe label, one-active-run rule 409) creating run + items from snapshot × viewports minus ignore rules; settings frozen.
- `CaptureRunWorkflow` (prepare/ensure bucket, enqueue batches, poll, finalise, 6 h timeout).
- Cancel and retry-failed endpoints + worker routes.
- Set baseline endpoint (RPC).

## Acceptance criteria
- [ ] Run with 3 pages × 2 viewports + 1 file creates 7 items.
- [ ] Second run while one is active → 409 with active run link.
- [ ] Cancel stops processing; run ends `cancelled` with done items preserved.
- [ ] Retry failed re-processes only failed items in the same label/prefix.
- [ ] Workflow tested with fakes (step logic as pure functions).
- [ ] Definition of done in `AGENTS.md` satisfied.

## Out of scope
UI (T13).
