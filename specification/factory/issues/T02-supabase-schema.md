# T02 — Supabase schema, RLS, seed and generated types

**Milestone:** M0
**Depends on:** T01

## Spec refs
- `specification/02-data-model.md (all)`
- `specification/04-auth-and-roles.md §2–§3`
- `specification/10-non-functional.md NFR-11, NFR-24`

## Scope
- `supabase init`; migrations for all enums and tables in 02 §1–§2, indexes and unique constraints.
- Helper functions `is_platform_admin()`, `project_role()`, `can_view/can_edit/can_admin()`; RLS policies per 02 §4; view `projects_public` (no encrypted columns, `has_basic_auth`).
- Trigger creating `profiles` row on `auth.users` insert.
- RPCs: `refresh_run_counts`, `refresh_comparison_counts`, `set_baseline`, `review_items`, `resolve_share_token` (signatures per 09 §5; `review_items` may be a stub that only updates review columns + counts — memory added in T20).
- `seed.sql`: platform admin, editor, viewer users; 1 project with desktop viewport and memberships.
- `pnpm db:start|db:reset|db:types|test:db` wired; `packages/db` exports generated types.
- RLS tests: for each role in 04 §3 matrix, allowed and denied operations on each table; test that fails if any public table has RLS disabled.

## Acceptance criteria
- [ ] `pnpm db:reset` from scratch succeeds.
- [ ] `pnpm test:db` covers every table × role (viewer/editor/project admin/platform admin/non-member) for select/insert/update/delete.
- [ ] Non-member cannot see a project or any child rows.
- [ ] Encrypted columns are not readable through `projects_public` or by non-admins.
- [ ] Generated types committed and up to date (CI check `pnpm db:types && git diff --exit-code`).
- [ ] Definition of done in `AGENTS.md` satisfied.

## Out of scope
Auth hook for invite-only sign-up (T07).
