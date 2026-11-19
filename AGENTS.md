

# Agent Rules <!-- tessl-managed -->

@.tessl/RULES.md follow the [instructions](.tessl/RULES.md)

## Project rules — Visual Regression Tool

You are implementing the **Visual Regression Tool** web app. The full specification is in
`specification/` — read `specification/README.md`, then the documents referenced by your ticket.
The original CLI prototype is in `prototype/`; its behaviour is restated normatively in
`specification/05-engine.md`. Never modify `prototype/` or `specification/factory/`; you may run
the prototype's pure functions to generate golden fixtures. `prototype/` is not part of the pnpm
workspace.

## Before you code

0. Your ticket is a GitHub issue imported from `specification/factory/issues/Txx-*.md`. Its
   *Depends on* issues are already merged; reuse what they built instead of re-creating it.
1. Read the issue fully: *Spec refs*, *Scope*, *Acceptance criteria*, *Out of scope*.
2. Read every spec section listed in *Spec refs*. If the spec and the issue conflict, the
   **issue wins for scope**, the **spec wins for behaviour**; mention the conflict in the PR.
3. If something is ambiguous and not decidable from the spec, choose the simplest option that
   keeps future requirements possible, and list it under "Assumptions" in the PR description.
4. Do not implement things listed as out of scope or belonging to other tickets.

## Stack (do not substitute)

pnpm workspaces + Turborepo · TypeScript strict · Next.js App Router (apps/web) · Tailwind +
shadcn/ui · zod · Supabase (Postgres, Auth, Realtime) with `@supabase/ssr` · Cloudflare Workers,
Workflows, Queues, Browser Rendering (`@cloudflare/puppeteer`), Containers (apps/diff-container)
· `pngjs` + `pixelmatch` · `aws4fetch` for R2 S3 API · Vitest · Playwright · Resend.

## Repository conventions

* Layout per `specification/01-architecture.md §2` (apps/, packages/, supabase/, fixtures/ at the repo root). New packages need an issue.
* Shared types/schemas live in `packages/shared`; never duplicate a contract in two apps.
* R2 keys are built only via `packages/shared/src/r2-keys.ts`.
* Engine code (`packages/engine`) is pure: no `fetch`, no fs, no env — inject dependencies.
* Env access only through the zod env schemas in `packages/shared/src/env.ts`; add every new
  variable to the schema **and** the app's `.env.example`.
* Database changes only via new files in `supabase/migrations/` (timestamped). Never edit an
  applied migration. Regenerate types: `pnpm db:types`. Every new table gets RLS + policies + tests.
* Server-only modules start with `import 'server-only'`. The Supabase service role key must never
  be imported from client components.
* Every mutating server action/route: validate input with zod, check permission with
  `assertCan(...)`, write audit log entry.
* UI: shadcn/ui components, accessible labels, loading/empty/error states for every async view.
* Naming: files `kebab-case.ts`, React components `PascalCase.tsx`, DB `snake_case`.
* Commits: Conventional Commits (`feat(web): …`, `fix(engine): …`).

## Commands

```bash
pnpm install
pnpm lint            # eslint
pnpm typecheck       # tsc --noEmit across workspace
pnpm test            # vitest (unit + golden)
pnpm db:start        # supabase start (local)
pnpm db:reset        # apply migrations + seed
pnpm db:types        # regenerate packages/db types
pnpm test:db         # RLS / RPC tests against local Supabase
pnpm test:e2e        # playwright (web); worker calls are stubbed
pnpm dev             # web + worker (wrangler dev) in parallel
```

## Definition of done (check before opening the PR)

* All acceptance criteria in the issue are met and each one is covered by a test where testable.
* `pnpm lint && pnpm typecheck && pnpm test` pass; `pnpm test:db` if migrations changed;
  `pnpm test:e2e` if UI changed.
* No secrets, real customer URLs or credentials committed. Tests use `fixtures/`.
* PR description starts with `Closes #<issue number>` (this closes the issue on merge, which
  releases the tickets it blocks), then: summary, `Implements: T.. (REQ-…, F-…)`, assumptions,
  screenshots for UI changes, follow-ups (as a checklist — do not silently drop work).
* One PR per ticket. If the ticket is too big, implement a coherent first part, list the rest as
  follow-ups, and do not close the issue (`Refs #N` instead of `Closes #N`).

## Never

* Never run against production Supabase/Cloudflare from an agent run.
* Never disable RLS, weaken a policy to make a test pass, or skip tests.
* Never change thresholds, filename scheme, normalisation CSS or fingerprint format of the engine
  without a spec change — they must stay compatible with existing R2 data.
