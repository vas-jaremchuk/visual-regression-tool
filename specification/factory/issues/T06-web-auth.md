# T06 — Web app skeleton with Supabase auth

**Milestone:** M1
**Depends on:** T02, T03

## Spec refs
- `specification/04-auth-and-roles.md §1–§3`
- `specification/08-ui.md §1–§2, §4`
- `specification/03-configuration.md §2`

## Scope
- Next.js app with Tailwind + shadcn/ui, dark/light theme, layout (sidebar, top bar, user menu) per 08 §2.
- `/login` magic link + Google button (hidden if not configured), auth callback, middleware session refresh + redirect to `/login?next=`.
- Disabled-user handling (REQ-AUTH-4).
- `assertCan(user, action, projectId)` helper + action enum matching 04 §3; used by all later routes.
- `pnpm seed:admin <email>` script (service role).
- Projects list page `/` (read-only from `projects_public`, empty state).
- Playwright setup with local Supabase + Inbucket magic-link helper.

## Acceptance criteria
- [ ] E2E: unauthenticated → redirect to login; magic link sign-in works; sign-out works.
- [ ] Viewer sees only projects they are a member of.
- [ ] Service role key not present in client bundle (CI grep on `.next/static`).
- [ ] Definition of done in `AGENTS.md` satisfied.

## Out of scope
Invitations (T07), project editing (T08).
