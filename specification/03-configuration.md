# 03 — Configuration

Rule: **`.env` / platform secrets hold only platform credentials.** Everything that differs
per website lives in the `projects` table and is edited in the UI.

## 1. Mapping from the prototype `.env`

| Prototype `.env` | New home |
|------------------|----------|
| `CF_ACCOUNT_ID`, `CF_API_TOKEN` | Platform env (web + worker) |
| `SITE_NAME` | `projects.name` |
| `SITEMAP_INDEX` | `projects.sitemap_index` |
| `R2_BUCKET` | `projects.r2_bucket` |
| `R2_PUBLIC_URL` | `projects.r2_public_url` |
| `BASIC_AUTH_USER` / `BASIC_AUTH_PASS` | `projects.basic_auth_user` / `basic_auth_pass_enc` (encrypted) |
| `CHROME_PATH` | Not needed (Browser Rendering) |
| `CHECK_CONCURRENCY` | constant 8 in engine (redirect check concurrency) |

A project can be created by pasting a prototype `.env` into an **Import from .env** dialog
(parser ignores `CF_*` and comments; shows a preview before saving) — F-PROJ-4.

## 2. `apps/web` environment (Vercel)

```dotenv
# App
APP_URL=https://vrt.example.com               # absolute URL used in emails & share links

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...             # publishable key
SUPABASE_SERVICE_ROLE_KEY=...                 # server only — invitations, share links

# Cloudflare
CF_ACCOUNT_ID=...
CF_API_TOKEN=...                              # Account › Workers R2 Storage: Edit (bucket list/create, usage)
R2_ACCESS_KEY_ID=...                          # R2 S3 API token (Object Read & Write, all buckets)
R2_SECRET_ACCESS_KEY=...
WORKER_URL=https://vrt-worker.<subdomain>.workers.dev
WORKER_SHARED_SECRET=...                      # HMAC key for web → worker calls (32+ random bytes, base64)

# Secrets at rest
SETTINGS_ENCRYPTION_KEY=...                   # 32 bytes base64, AES-256-GCM for basic-auth passwords & Slack URLs

# Email
RESEND_API_KEY=...
EMAIL_FROM="Visual Regression <vrt@example.com>"
```

## 3. `apps/worker` + `apps/diff-container` (wrangler secrets / vars)

```dotenv
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
CF_ACCOUNT_ID=...
CF_API_TOKEN=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
WORKER_SHARED_SECRET=...
SETTINGS_ENCRYPTION_KEY=...
RESEND_API_KEY=...
EMAIL_FROM=...
APP_URL=...
DIFF_CONTAINER_SHARED_SECRET=...   # worker → container auth
```

`wrangler.jsonc` bindings (names are part of the contract):

| Binding | Type | Purpose |
|---------|------|---------|
| `BROWSER` | Browser Rendering | capture |
| `CAPTURE_RUN` | Workflow `CaptureRunWorkflow` | |
| `COMPARE_RUN` | Workflow `CompareWorkflow` | |
| `SITEMAP_FETCH` | Workflow `SitemapWorkflow` | |
| `CAPTURE_QUEUE` | Queue producer+consumer `vrt-capture` | DLQ `vrt-capture-dlq` |
| `DIFF_QUEUE` | Queue producer+consumer `vrt-diff` | DLQ `vrt-diff-dlq` |
| `DIFF_CONTAINER` | Durable Object / Container class `DiffContainer` | instance_type with ≥ 1 GiB RAM |

## 4. Every app validates its env at boot

`packages/shared/env.ts` exports zod schemas `webEnv`, `workerEnv`. Missing/invalid vars fail
fast with a message naming the variable (prototype did this for `CF_*`/`R2_BUCKET`).
`.env.example` files in each app list every variable with a comment; they are kept in sync by a
unit test that compares schema keys with the example file.

## 5. Secret encryption

* Algorithm AES-256-GCM, random 12-byte IV, stored as `v1:<iv b64>:<ciphertext+tag b64>`.
* Implemented once in `packages/shared/crypto.ts` using WebCrypto (works in Next.js, Workers, Node).
* Encryption happens server-side in the web app on save; decryption only in the worker when building
  request headers. The UI shows "••••• (set)" and offers *Replace* / *Clear*, never the value.
* Key rotation: support a comma-separated list in `SETTINGS_ENCRYPTION_KEY`; first key encrypts, all keys try to decrypt.

## 6. Per-project settings (UI groups)

| Group | Fields |
|-------|--------|
| General | name, slug (read-only after first run), sitemap index URL, notes |
| Storage | R2 bucket (validate name `[a-z0-9-]{3,63}`; *Check / create bucket* button), R2 public URL (*Test* button fetches a known object) |
| Access | basic auth user + password |
| Capture | concurrency, page timeout, settle wait, max page height, check redirects, file extensions override, hide selectors, extra CSS |
| Viewports | list with add/edit/disable/reorder, presets |
| Diff | per-pixel threshold (0–1), change threshold % |
| Ignore rules | table, see F-IGNORE |
| Notifications | channels, see F-NOTIFY |
| Members | see `04-auth-and-roles.md` |
| Danger zone | archive project, delete project (requires typing slug; does not delete the bucket unless the checkbox *also delete R2 objects* is ticked) |

All numeric settings have min/max validation in the shared zod schema (`projectSettingsSchema`).
