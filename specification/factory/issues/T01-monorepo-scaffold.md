# T01 — Monorepo scaffold, tooling and CI

**Milestone:** M0
**Depends on:** none

## Spec refs
- `specification/01-architecture.md §2, §6`
- `specification/03-configuration.md §4`
- `specification/11-testing.md §3`
- `AGENTS.md`

## Scope
- pnpm workspace + Turborepo with empty `apps/web` (Next.js app router hello page), `apps/worker` (wrangler hello Worker), `apps/diff-container` (Node HTTP hello + Dockerfile), `packages/{engine,shared,db,storage}` (TS libs with one sample test each).
- Root scripts exactly as listed in AGENTS.md (`lint`, `typecheck`, `test`, `db:*`, `test:e2e`, `dev`) — db/e2e scripts may be placeholders that print "not yet configured" and exit 0.
- TS strict base config, ESLint + Prettier, Vitest workspace config.
- GitHub Actions `ci.yml`: install, lint, typecheck, test on PRs and `main`. Keep the existing `.github/workflows/tessl-release.yml`, `.tessl/`, `tessl.json`, `AGENTS.md`, `CLAUDE.md` untouched (only extend `.tessl/cloud-launch-setup.sh` if needed).
- `pnpm-workspace.yaml` includes `apps/*` and `packages/*` only (not `prototype/`).
- `.nvmrc`/`engines` Node >= 20, `.gitignore` (node_modules, .env*, .wrangler, .next, coverage).
- `fixtures/` folder with README describing planned fixtures (11-testing §2).

## Acceptance criteria
- [ ] `pnpm install && pnpm lint && pnpm typecheck && pnpm test` succeed on a clean clone.
- [ ] `pnpm --filter web build` builds; `pnpm --filter worker exec wrangler deploy --dry-run` succeeds.
- [ ] `docker build apps/diff-container` succeeds.
- [ ] CI workflow runs on PR and is green.
- [ ] Definition of done in `AGENTS.md` satisfied.

## Out of scope
Supabase setup (T02), any feature code.
