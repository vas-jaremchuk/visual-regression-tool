# Runbook

Operating the Visual Regression Tool: environments, secrets, deploys, rollback, key rotation,
adding a project, stuck jobs and Cloudflare limits. First-time setup of the hosted services is in
`specification/13-deployment-setup.md`; this runbook assumes it is done.

## 1. Environments

| Environment | Web (`apps/web`) | Worker, Workflows, Queues, diff container (`apps/worker`) | Database and Auth | Used by |
| ----------- | ---------------- | --------------------------------------------------------- | ----------------- | ------- |
| Local | `pnpm dev` (Next.js on :3000) | `wrangler dev` on :8787 (containers off by default) | `pnpm db:start` (Supabase in Docker), mail in Mailpit | developers, agents, CI (`pnpm test`, `test:db`, `test:e2e`) |
| Staging | Vercel environment of its own (or a protected preview) | Cloudflare account of its own | Supabase project of its own | release acceptance (`Staging acceptance` workflow) |
| Production | Vercel production | Cloudflare production account, deployed by `Deploy worker` | Supabase production project | users |

Rules:

* Staging and production never share a Supabase project, an R2 bucket or a secret value.
* Worker, Workflow and Queue names are fixed in `apps/worker/wrangler.jsonc`, so two stacks in
  one Cloudflare account would collide: give staging its own account.
* Agents and CI only ever use local values. Nothing in this repository runs against production
  except the `Deploy worker` workflow.

### Fixture site (staging only)

`apps/worker/wrangler.fixture-site.jsonc` deploys `vrt-fixture-site`, a Worker that serves
`fixtures/site/` (see `fixtures/README.md`) as the site under test for release acceptance. Its
`SITE_VERSION` variable picks the version:

| Version | Content |
| ------- | ------- |
| `v1` | home, about (with an image), blog post, a redirect `/old-page/` → `/about/`, a 404 `/missing/`, a PDF |
| `v2` | same URLs; home heading and about image changed, different PDF bytes, `/contact/` added, blog post removed |

Switch it by redeploying (takes a few seconds; `GET /__fixture/version` shows what is served):

```bash
cd apps/worker
pnpm exec wrangler deploy --config wrangler.fixture-site.jsonc --var SITE_VERSION:v2
```

## 2. Secrets

Never commit any value. Keep local copies outside the repository (e.g. `~/vrt-production.env`).
Each app validates its variables at startup with the zod schemas in `packages/shared/src/env.ts`
and names every missing one; the `.env.example` next to each app documents them.

| Variable | Web (Vercel) | Worker (GitHub `production`) | Container | Notes |
| -------- | :-: | :-: | :-: | ----- |
| `APP_URL` | ✓ | ✓ | | links in emails and share links |
| `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_URL` | ✓ | ✓ | | same project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✓ | | | public |
| `SUPABASE_SERVICE_ROLE_KEY` | ✓ | ✓ | | server only; CI greps the client bundle for it |
| `CF_ACCOUNT_ID` | ✓ | ✓ | ✓ | |
| `CF_API_TOKEN` | ✓ | ✓ | | runtime: R2 bucket admin, Queues read |
| `CLOUDFLARE_API_TOKEN` | | ✓ | | deploy token for wrangler |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | ✓ | ✓ | ✓ | R2 S3 API, Object Read & Write |
| `WORKER_URL` | ✓ | | | |
| `WORKER_SHARED_SECRET` | ✓ | ✓ | | HMAC of web → worker calls; same value on both sides |
| `SETTINGS_ENCRYPTION_KEY` | ✓ | ✓ | | AES-256-GCM keys, comma-separated; same value on both sides |
| `DIFF_CONTAINER_SHARED_SECRET` | | ✓ | ✓ | worker → container bearer token (the deploy passes it on) |
| `RESEND_API_KEY`, `EMAIL_FROM` | ✓ | ✓ | | |
| `EMAIL_TRANSPORT`, `GOOGLE_AUTH_ENABLED` | ✓ | | | `resend`, `false` unless Google sign-in is set up |
| `SSRF_ALLOW_HOSTS`, `MAILPIT_URL` | empty | empty | | local development only |

Staging acceptance (GitHub environment `staging`, validated by `stagingEnv`, documented in
`apps/web/e2e-staging/.env.example`):

| Secret | Value |
| ------ | ----- |
| `CLOUDFLARE_API_TOKEN`, `CF_ACCOUNT_ID` | staging Cloudflare account; deploys the fixture site |
| `STAGING_APP_URL` | staging web URL |
| `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_SERVICE_ROLE_KEY` | staging Supabase project (test users, sign-in links, outcome checks) |
| `STAGING_FIXTURE_SITE_URL` | `https://vrt-fixture-site.<subdomain>.workers.dev` |
| `STAGING_ADMIN_EMAIL` | a staging platform admin (`pnpm seed:admin`); editor and viewer are its `+vrt-editor` / `+vrt-viewer` aliases, so notification emails land in its mailbox |
| `STAGING_SLACK_WEBHOOK_URL` | incoming webhook of a test Slack channel |
| `STAGING_LEGACY_ENV` | a prototype `.env` (multi-line) whose bucket holds real prototype runs; choose a site with a small sitemap, step 8 captures it once |

## 3. Deploy

Order matters when a change spans components: **database, then worker, then web**.

1. **Database.** Merged PRs with files in `supabase/migrations/` must be applied:
   `pnpm exec supabase link --project-ref <ref>` then `pnpm exec supabase db push --remote`, and
   `pnpm exec supabase migration list --remote` shows every migration applied. Never run
   `supabase db reset` against a hosted project.
2. **Worker and diff container.** `Deploy worker` runs on every push to `main` that touches the
   worker, the container or the packages they use (and on demand: Actions → Deploy worker → Run
   workflow). It runs typecheck and tests, makes sure the queues exist, uploads the secrets and
   deploys. Check: `curl $WORKER_URL/health`.
3. **Web.** Vercel deploys `main` to production by itself.
4. **Release acceptance.** Before a release: Actions → **Staging acceptance** → Run workflow,
   once staging runs the same commit. It deploys the fixture site at `v1` and runs
   `apps/web/e2e-staging` (steps 1 to 9 of `specification/11-testing.md §4`). A run takes about
   20 to 40 minutes; on failure the Playwright traces are attached as `staging-acceptance-results`.
   Run it locally with the same variables: `pnpm test:staging`.

## 4. Rollback

* **Web:** Vercel → Deployments → previous production deployment → *Promote to Production*.
* **Worker:** `cd apps/worker && pnpm exec wrangler deployments list`, then
  `pnpm exec wrangler rollback <version-id>`. Running Workflow instances continue on the version
  they started with. Or revert the commit on `main` and let `Deploy worker` redeploy.
* **Database:** migrations are forward only. Write a new migration that undoes the change, merge
  it and `db push --remote`. Roll back the worker and web first if they rely on the new schema.
* After any rollback, run the staging acceptance suite against staging at the same versions.

## 5. Rotating keys

| Key | How |
| --- | --- |
| `SETTINGS_ENCRYPTION_KEY` | Prepend a new key: `NEW,OLD` (first key encrypts, every key decrypts). Update Vercel and GitHub, redeploy worker and web. Secrets are re-encrypted with the new key when saved again (re-enter each project's basic-auth password and Slack webhooks). Remove `OLD` only after that, then redeploy. Dropping a key that still encrypts something makes those secrets unreadable. |
| `WORKER_SHARED_SECRET` | Single value: update GitHub and Vercel, run `Deploy worker`, redeploy web. Web → worker calls fail with 401 between the two deploys, so do it at a quiet time and retry failed job starts. |
| `DIFF_CONTAINER_SHARED_SECRET` | Update the GitHub secret, run `Deploy worker` (worker and container roll out together). |
| `SUPABASE_SERVICE_ROLE_KEY` | Rotate in Supabase (Settings → API keys), update Vercel, GitHub and the staging secret if it is staging, redeploy worker and web. |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | Create a new R2 API token, update Vercel and GitHub, redeploy both, then delete the old token. |
| `CF_API_TOKEN`, `CLOUDFLARE_API_TOKEN` | Create the new token with the same permissions (`specification/13-deployment-setup.md §1`), update, redeploy, revoke the old one. |
| `RESEND_API_KEY` | New key in Resend, update Vercel and GitHub, redeploy, revoke the old key. |

## 6. Adding a project

1. Sign in as a platform admin (`pnpm seed:admin <email>` makes one) → **New project**. To move a
   prototype site, use *Import from .env* with its prototype `.env`: name, bucket, sitemap and
   basic auth are filled in; Cloudflare credentials in it are ignored.
2. *Check bucket*: the bucket is created on the first run if it does not exist.
3. Settings → Viewports (desktop is created by default), Capture, Access (basic auth), Notifications.
4. Settings → Members: invite editors and viewers (existing accounts are added directly).
5. *Fetch sitemap*, then start the first run. To keep earlier prototype screenshots, use
   **Import existing runs** on the project page (project admin): prototype runs in the bucket
   become legacy runs that can be compared with new ones.

## 7. Troubleshooting stuck jobs

Start at **Admin → Jobs** (platform admins): active jobs, those with no progress for more than
15 minutes marked *stuck*, dead letter queue counts and recent failures.

* **Run or comparison stuck at queued.** The Workflow did not start: check `wrangler tail` in
  `apps/worker` for HMAC errors (mismatched `WORKER_SHARED_SECRET`, or clock skew above 5 minutes)
  and the Workflow instance in the Cloudflare dashboard (Workers → Workflows). Cancel it from the
  run page and start again.
* **Run running with no progress.** Capture messages wait for a Browser Rendering slot
  (`ProjectLimiter`): a crashed consumer frees its slot after 15 minutes. Check Browser Rendering
  concurrency in the dashboard; lower the project's capture concurrency if the account limit is hit.
  After the 6 hour hard timeout the run is finalised with whatever items finished.
* **Messages in a dead letter queue** (`vrt-capture-dlq`, `vrt-diff-dlq`). Each failed 3 attempts;
  the item is marked failed. Fix the cause (the run's *Failures* tab shows the error), then
  *Retry failed* on the run, or re-diff the comparison. Purge the DLQ in the dashboard once handled.
* **Comparison diffs never finish.** The diff container is down or rejects the worker: check
  container logs in the dashboard and that `DIFF_CONTAINER_SHARED_SECRET` matches.
* **Run `delete_failed`.** R2 refused the delete; rows are kept until the objects are gone. Use
  *Retry delete* on the storage page.
* **Sitemap fetch failed.** The snapshot's error names the URL; the SSRF guard refuses private
  hosts, and a basic-auth site needs the password in Settings → Access.
* **Staging acceptance failed.** Open the trace in `staging-acceptance-results`. If the fixture
  site was left on `v2`, redeploy it with `SITE_VERSION:v1` (the suite does this at the start of
  every run anyway). The suite deletes and recreates its projects (`vrt-staging-acceptance`,
  `vrt-staging-legacy`) on each run; screenshots of earlier attempts stay in the
  `vrt-staging-acceptance` bucket and can be emptied in the R2 dashboard.

## 8. Cloudflare limits

`apps/worker/LIMITS.md` lists the Cloudflare limits the worker is designed against (Browser
Rendering, Workflows, Queues, Containers, R2), when they were last checked and which constants
depend on them. The ones that matter in operation:

* **Browser Rendering:** concurrent browsers per account and new browsers per second. The Workers
  Free plan cannot run real captures.
* **Queues:** 15 minutes wall time per consumer invocation, so a batch of 10 pages × the page
  timeout must fit.
* **Workflows:** 7 days retention of finished instances by default; status lives in Supabase.
* **R2 free tier:** 10 GB of storage (`FREE_TIER_BYTES`); the storage page shows usage against it.

Re-check `LIMITS.md` against the Cloudflare docs before raising capture concurrency, batch sizes
or timeouts.
