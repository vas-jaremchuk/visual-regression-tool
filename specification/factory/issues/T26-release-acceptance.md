# T26 — Staging smoke test, release acceptance and runbook

**Milestone:** M5
**Depends on:** T19, T20, T21, T22, T23, T24, T25

## Spec refs
- `specification/11-testing.md §4`
- `specification/12-delivery-plan.md manual steps`

## Scope
- Deploy fixture site (v1/v2 switchable) somewhere reachable (e.g. Cloudflare Pages or a Worker serving `fixtures/site`).
- Playwright staging suite implementing release acceptance steps 1–9.
- `docs/runbook.md`: environments, secrets list, deploy, rollback, rotating keys, adding a project, troubleshooting stuck jobs, Cloudflare limits.

## Acceptance criteria
- [ ] Staging suite green on a manual GitHub Actions trigger.
- [ ] Runbook reviewed by product owner.
- [ ] Definition of done in `AGENTS.md` satisfied.

## Out of scope
- Anything not listed in Scope; see `specification/12-delivery-plan.md` for the owning ticket.
