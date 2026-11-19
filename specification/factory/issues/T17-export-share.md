# T17 — Static export, download and public share links

**Milestone:** M3
**Depends on:** T16

## Spec refs
- `specification/01-architecture.md ADR-5`
- `specification/05-engine.md §9`
- `specification/04-auth-and-roles.md §5`
- `specification/07-features.md F-CMP-8`

## Scope
- Workflow export step writes `reports/<label>/index.html` when `r2_public_url` set; `GET /api/comparisons/:id/export.html` download for everyone with view access.
- Share link create/revoke with expiry; `/share/[token]` read-only report (no nav, no review, banner).
- Signed image URLs for share viewers scoped to that comparison.

## Acceptance criteria
- [ ] Revoked/expired token → 404.
- [ ] Share page exposes no other project data (API calls audited in test).
- [ ] Downloaded HTML opens offline-friendly with absolute image URLs.
- [ ] Definition of done in `AGENTS.md` satisfied.

## Out of scope
- Anything not listed in Scope; see `specification/12-delivery-plan.md` for the owning ticket.
