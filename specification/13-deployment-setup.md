# 13 — Deployment setup (secrets & linking)

One-time setup to run the app for real: **Supabase** (DB + auth) → **Cloudflare** (worker,
queues, workflows, diff container, R2) → **Vercel** (web UI), linked by shared secrets.

```
Browser ──▶ Vercel (apps/web) ──HMAC(WORKER_SHARED_SECRET)──▶ Cloudflare Worker ──▶ Container
              │                                                  │
              └────────────── Supabase (service role / anon) ◀───┘        R2 (S3 keys)
```

## 1. Create the values (once)

| Value | Where to get it |
|-------|-----------------|
| `CF_ACCOUNT_ID` | Cloudflare dashboard URL `dash.cloudflare.com/<account-id>/…` |
| `CLOUDFLARE_API_TOKEN` (deploy) | My Profile → API Tokens → Create. Account permissions **Edit**: Workers Scripts, Queues, Workers R2 Storage, Containers, Cloudchamber, Browser Rendering (if listed); Account Settings **Read** |
| `CF_API_TOKEN` (runtime) | Token with Account → Workers R2 Storage **Edit** (bucket check/create, usage). May be the same token as above |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | R2 → Manage R2 API Tokens → Create API token → **Object Read & Write**, all buckets → copy Access Key ID + Secret Access Key |
| `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` | Supabase project → Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same page → publishable / anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | same page → secret / service_role key (**server only**) |
| `WORKER_SHARED_SECRET` | `openssl rand -base64 32` — **same value in GitHub and Vercel** |
| `SETTINGS_ENCRYPTION_KEY` | `openssl rand -base64 32` — **same value in GitHub and Vercel**; never change it without rotation (encrypted basic-auth passwords become unreadable) |
| `DIFF_CONTAINER_SHARED_SECRET` | `openssl rand -base64 32` (GitHub only) |
| `RESEND_API_KEY`, `EMAIL_FROM` | resend.com → API Keys; sender on a verified domain, e.g. `Visual Regression <vrt@yourdomain>` |
| `APP_URL` | the Vercel production URL, e.g. `https://visual-regression-tool.vercel.app` (set after step 4, update the GitHub secret then) |
| `WORKER_URL` | `https://visual-regression-worker.<your-subdomain>.workers.dev` — printed by the first successful deploy (step 3) |

## 2. Supabase (hosted project)

```bash
pnpm exec supabase login
pnpm exec supabase link --project-ref <project-ref>
pnpm exec supabase db push --remote             # applies supabase/migrations/* to the hosted project
pnpm exec supabase migration list --remote      # every row needs a Remote value
```
The Supabase CLI targets the local Docker stack by default even after `link`: always pass
`--remote` for the hosted project. Never run `supabase db reset` against it. Re-run `db push --remote`
whenever a merged PR adds a migration.

Dashboard:
* **Authentication → Hooks → Before User Created** → Postgres function `public.before_user_created_hook` (invite-only sign-up).
* **Authentication → URL Configuration**: Site URL = `APP_URL`; Redirect URLs = `APP_URL/**` and `https://*-<vercel-team>.vercel.app/**` (previews).
* Authentication → Emails/SMTP: use Resend SMTP (or the built-in sender for testing).
* First admin: fill `apps/web/.env.local` (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, …), then `pnpm seed:admin <your-email>`.

## 3. GitHub → Cloudflare worker deploy (`.github/workflows/deploy-worker.yml`)

The job uses the **`production` environment**: Settings → Environments → New environment
`production` → add the secrets there (repository secrets also work).

Secrets (13): `CLOUDFLARE_API_TOKEN`, `CF_ACCOUNT_ID`, `CF_API_TOKEN`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `WORKER_SHARED_SECRET`,
`SETTINGS_ENCRYPTION_KEY`, `DIFF_CONTAINER_SHARED_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `APP_URL`.

Fastest: put them in a local file **outside the repo** and load with gh:
```bash
gh secret set --env production -f ~/vrt-production.env    # dotenv format KEY=value
gh secret list --env production
```
Then Actions → **Deploy worker** → Run workflow. The log of "Deploy worker and diff container"
prints the `workers.dev` URL → that is `WORKER_URL`. Check: `curl <WORKER_URL>/health`.

## 4. Vercel (web UI)

New Project → import the GitHub repo → **Root Directory `apps/web`**, framework Next.js
(Vercel installs from the monorepo root automatically).
If the install fails on pnpm 12 (Corepack), set **Install Command**:
`npm i -g pnpm@12.21.0 && pnpm install --frozen-lockfile`.

Environment variables (Production, and Preview if you want preview deploys to work):
`APP_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`CF_ACCOUNT_ID`, `CF_API_TOKEN`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `WORKER_URL`,
`WORKER_SHARED_SECRET`, `SETTINGS_ENCRYPTION_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`,
`EMAIL_TRANSPORT=resend`, `GOOGLE_AUTH_ENABLED=false`. Leave `SSRF_ALLOW_HOSTS` and `MAILPIT_URL` empty.

Or with the CLI: `vercel link` then `vercel env add <NAME> production` per variable.

After the first deploy: set `APP_URL` to the Vercel URL in **both** Vercel and GitHub, update the
Supabase Site URL, redeploy both.

## 5. Smoke test

1. Sign in at `APP_URL` with the seeded admin (magic link).
2. Create a project (or import a prototype `.env`) → *Check bucket*.
3. *Fetch sitemap* → progress appears (proves web → worker HMAC + worker → Supabase).
4. Worker logs: `pnpm exec wrangler tail` in `apps/worker`.

## Rules

* Never commit any of these values; `.env*` is git-ignored. Keep `~/vrt-production.env` outside the repo.
* Tessl agents get **local/dev** values only, never these production secrets.
* Rotating `WORKER_SHARED_SECRET`: update GitHub + Vercel, redeploy both.
