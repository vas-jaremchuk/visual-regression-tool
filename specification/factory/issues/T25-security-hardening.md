# T25 — Security hardening

**Milestone:** M5
**Depends on:** T17

## Spec refs
- `specification/10-non-functional.md NFR-11..18`
- `specification/04-auth-and-roles.md`

## Scope
- Review and close gaps: SSRF guard everywhere, rate limiting job endpoints, CSP and security headers, `server-only` audit, escaped exports, share token constant-time compare, secret redaction in logs.
- CI checks: RLS-enabled test, client bundle secret grep, dependency audit.

## Acceptance criteria
- [ ] Checklist in PR with evidence (test names) for NFR-11..18.
- [ ] Rate limit returns 429 after 10 starts/min per user.
- [ ] Definition of done in `AGENTS.md` satisfied.

## Out of scope
- Anything not listed in Scope; see `specification/12-delivery-plan.md` for the owning ticket.
