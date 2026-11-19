# 01 — Architecture

## 1. Component diagram

```mermaid
flowchart LR
  U[User browser] -->|HTTPS| W[apps/web<br/>Next.js on Vercel]
  W -->|Auth, CRUD, Realtime| S[(Supabase<br/>Postgres + Auth + Realtime)]
  W -->|signed HTTP: start/cancel job| CF[apps/worker<br/>Cloudflare Worker]
  CF --> WF[Cloudflare Workflows<br/>run & compare orchestration]
  WF --> Q[Cloudflare Queues<br/>capture-batches / compare-batches]
  Q --> CC[Capture consumer<br/>Worker + Browser Rendering]
  Q --> DC[Diff consumer<br/>Cloudflare Container<br/>Node + pngjs + pixelmatch]
  CC -->|PUT png/txt| R2[(Cloudflare R2<br/>bucket per project)]
  DC -->|GET/PUT png| R2
  CC -->|status rows| S
  DC -->|status rows| S
  WF -->|status, notifications| S
  WF --> N[Email (Resend) / Slack webhook]
  U -->|images via R2 public URL or signed URL| R2
```

## 2. Repository layout (monorepo, pnpm + Turborepo, TypeScript everywhere)

```
/
├─ apps/
│  ├─ web/                  Next.js (App Router) — deployed to Vercel
│  ├─ worker/               Cloudflare Worker: HTTP API, Workflows, Queue consumers (wrangler)
│  └─ diff-container/       Dockerfile + Node HTTP server for pixel diffs (Cloudflare Containers)
├─ packages/
│  ├─ engine/               Pure, runtime-agnostic logic ported from the prototype (no I/O)
│  ├─ shared/               zod schemas, job contracts, enums, constants, R2 key builders
│  ├─ db/                   generated Supabase types + typed query helpers
│  └─ storage/              R2 client (S3 API via aws4fetch) + bucket admin (CF REST API)
├─ supabase/
│  ├─ migrations/           SQL migrations (schema, RLS, functions)
│  └─ seed.sql              local dev seed
├─ docs/specification/      this specification
├─ .tessl/cloud-launch-setup.sh
├─ AGENTS.md
└─ turbo.json, pnpm-workspace.yaml, package.json
```

## 3. Responsibilities

| Component | Owns | Must NOT |
|-----------|------|----------|
| `apps/web` | UI, auth session, CRUD on settings, permission checks, starting/cancelling jobs, rendering reports, share links | Launch browsers, decode PNGs, run anything > 10 s |
| `apps/worker` (Worker) | Verifying signed requests, creating Workflow instances, sitemap fetch, Queue consumers for capture, writing progress to Supabase | Serve UI, hold user sessions |
| Workflows | Durable step sequence per run/comparison: prepare → fan-out → wait → finalise → notify | Do per-URL heavy work inline |
| `apps/diff-container` | PNG decode, pad, pixelmatch, ignore-region masking, diff PNG encode | Talk to users or Supabase Auth |
| `packages/engine` | Filename scheme, file detection, fingerprint parse/format, sitemap XML parsing, normalisation CSS, diff maths, report HTML export | Any network or filesystem I/O (inject it) |
| Supabase | Users, roles, projects, settings, runs, items, comparisons, reviews, audit | Store images |
| R2 | Screenshots, fingerprints, diffs, static report exports | Store metadata that the UI queries (use DB) |

## 4. Main flows

### 4.1 Capture run

1. Editor clicks **New run** → `POST /api/projects/:id/runs` (web).
2. Web validates permission, inserts `runs` row (`status=queued`) and its `run_items`
   (from the latest sitemap snapshot × selected viewports, minus ignore rules), then calls
   the worker `POST /jobs/capture` with an HMAC signature.
3. Worker starts Workflow `CaptureRunWorkflow(runId)`.
4. Workflow: mark `running` → ensure bucket → split pending items into batches
   (default 10 items) → send to queue `capture-batches`.
5. Capture consumer: for each batch acquire a Browser Rendering session (reuse sessions),
   screenshot/fingerprint each item exactly as `05-engine.md`, PUT to R2, update
   `run_items` row (`done`/`failed`, size, dimensions, sha256…). Retries per §06.
6. Workflow polls DB counters (step with sleep) until no `pending/processing` items
   remain or the run is cancelled → sets `completed` / `completed_with_errors` / `cancelled`.
7. Web UI receives progress through Supabase Realtime on `runs` / `run_items`.

### 4.2 Comparison

1. Editor selects before/after runs → `POST /api/projects/:id/comparisons`.
2. Web inserts `comparisons` row; worker `POST /jobs/compare` starts `CompareWorkflow`.
3. Workflow builds the item matrix (union of keys, see `05-engine.md §6`), records
   `new` / `missing` immediately, runs redirect detection for pairs, enqueues pairs to
   `compare-batches`, and compares file fingerprints inline (cheap).
4. Diff consumer forwards each pair to the **diff container** (HTTP to a Container
   instance via Durable Object binding). Container downloads both PNGs from R2, diffs,
   uploads diff PNG to R2 if changed, returns metrics. Consumer writes `comparison_items`.
5. Workflow finalises counts, auto-applies previous approvals (§07 F-REVIEW-6), optionally
   exports the static HTML report to R2, sends notifications.

## 5. Architecture decision records

### ADR-1 Jobs run on Cloudflare, not Vercel
Vercel functions have execution-time limits far below an 800-URL run (prototype: ~3–6 s per
page, concurrency 2 → ~40 min). Cloudflare already hosts R2; Workflows give durable,
resumable orchestration (replaces `.screenshot-progress.json`), Queues give fan-out with
retries, Browser Rendering gives managed headless Chromium.
*Rejected:* separate VPS worker (ops burden), laptop runner (not hosted).

### ADR-2 Pixel diff runs in a Cloudflare Container
A full-page 1280×10 000 px PNG is ~51 MB as RGBA. Diffing needs before + after + diff
buffers (~150 MB+), above the Worker memory limit (128 MB). A container with ≥ 1 GB RAM
runs the same `pngjs` + `pixelmatch` code as the prototype (bit-for-bit comparable results).
Capture stays on Browser Rendering (screenshots are produced by the remote browser; the Worker
only streams bytes to R2).
*Fallback (documented, not built):* run capture in the same container with `puppeteer-core`
+ Chromium if Browser Rendering limits (concurrency, session time) prove insufficient.
The engine's `BrowserProvider` interface must make this a configuration change.

### ADR-3 R2 accessed via S3-compatible API with one global key pair
Each project can use a different bucket, so static Worker bindings are not enough. All
object I/O goes through `packages/storage` using the R2 S3 endpoint
(`https://<account>.r2.cloudflarestorage.com`) signed with `aws4fetch`. Bucket creation and
listing use the Cloudflare REST API with `CF_API_TOKEN` (same as prototype `ensureBucket`).

### ADR-4 Metadata in Postgres, binaries in R2
The prototype derived everything from R2 listings and `sitemap.txt`. The web app needs
filtering, reviews and history, so every run item and comparison item is a DB row. R2 listing
is only used for storage accounting and legacy import.

### ADR-5 Report is rendered by the web app; static HTML export kept for parity
The interactive report lives at `/p/:project/comparisons/:id`. If the project has
`r2_public_url`, a static `reports/<label>/index.html` (prototype format) is also exported
so existing sharing habits keep working.

### ADR-6 Supabase is accessed with the user's JWT from the web app
Web server components/actions use `@supabase/ssr` with the user session so RLS enforces
permissions. The service-role key is used only by the worker/container and by narrowly
scoped server-side admin actions (invitations, share-link resolution).

## 6. Technology choices

| Concern | Choice |
|---------|--------|
| Language | TypeScript (strict), Node 20+ |
| Web | Next.js (App Router, Server Actions), React, Tailwind CSS, shadcn/ui, TanStack Table |
| Validation | zod (shared between web, worker, container) |
| DB | Supabase Postgres, migrations via Supabase CLI, types via `supabase gen types` |
| Auth | Supabase Auth (magic link + Google OAuth), `@supabase/ssr` |
| Realtime | Supabase Realtime (postgres_changes on `runs`, `comparisons`) |
| Jobs | Cloudflare Workflows, Queues, Browser Rendering (`@cloudflare/puppeteer`), Containers |
| Image diff | `pngjs` + `pixelmatch` (same major versions behaviour as prototype) |
| Email | Resend |
| Tests | Vitest (unit), Playwright (web e2e), Miniflare / `wrangler dev` (worker), Supabase local |
| Lint/format | ESLint + Prettier, `tsc --noEmit` in CI |
| CI | GitHub Actions: lint, typecheck, unit, e2e (web + local Supabase) |
| Deploy | Vercel (web, preview per PR), `wrangler deploy` (worker + container) via GitHub Actions on `main` |
