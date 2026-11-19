# T09 — Worker scaffold, HMAC API and deploy pipeline

**Milestone:** M2
**Depends on:** T03

## Spec refs
- `docs/specification/01-architecture.md §3, ADR-1`
- `docs/specification/03-configuration.md §3`
- `docs/specification/04-auth-and-roles.md §6`
- `docs/specification/09-api.md §2`
- `docs/specification/06-jobs.md §8`

## Scope
- `apps/worker` with `wrangler.jsonc` declaring all bindings in 03 §3 (Workflows/Queues classes may be stubs).
- Router with HMAC middleware for `/jobs/*`, unsigned `/health`.
- Supabase service client for Workers; structured JSON logger.
- Web-side `workerClient` (server-only) that signs requests.
- GitHub Action `deploy-worker.yml` on `main` (wrangler deploy with secrets from GitHub); deploy of container image included.
- `apps/worker/LIMITS.md` recording current Cloudflare limits used (06 note).

## Acceptance criteria
- [ ] Unsigned or badly signed requests → 401; valid → 200 stub responses.
- [ ] Workflow and Queue stubs deploy in `wrangler dev`.
- [ ] Worker env validated at startup with `workerEnv`.
- [ ] Definition of done in `AGENTS.md` satisfied.

## Out of scope
Real job logic (T10+).
