# T07 — Invitations, project members and user admin

**Milestone:** M1
**Depends on:** T06

## Spec refs
- `specification/04-auth-and-roles.md §1, §4`
- `specification/07-features.md F-ADMIN-1`
- `specification/02-data-model.md invitations, project_members`

## Scope
- Invite-only enforcement (Supabase before-user-created auth hook, or callback fallback described in 04 §1).
- Project members tab: list, invite by email + role, change role, remove; resend/revoke invitation.
- `/invite/[token]` accept flow.
- `/admin/users`: list, invite (platform-level), disable/enable, promote/demote platform admin.
- Emails via Resend (template: inviter, project, role, link). Email sending behind an interface with a fake for tests.

## Acceptance criteria
- [ ] Uninvited email cannot create an account.
- [ ] Invitation expires after 7 days; revoked invitation link shows an error.
- [ ] Project admin cannot manage members of other projects; editor cannot invite (403 + hidden UI).
- [ ] All membership changes write audit_log.
- [ ] Definition of done in `AGENTS.md` satisfied.

## Out of scope
- Anything not listed in Scope; see `specification/12-delivery-plan.md` for the owning ticket.
