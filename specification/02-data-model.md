# 02 — Data model

All tables live in schema `public`, have `id uuid primary key default gen_random_uuid()`
(unless stated), `created_at timestamptz default now()`, and RLS **enabled**.
Timestamps are UTC. Enums are Postgres enums.

## 1. Enums

```sql
create type project_role      as enum ('admin', 'editor', 'viewer');
create type run_status        as enum ('queued','running','completed','completed_with_errors','failed','cancelled','deleting','delete_failed');
create type item_kind         as enum ('page','file');
create type item_status       as enum ('pending','processing','done','failed','skipped');
create type comparison_status as enum ('queued','running','completed','failed','cancelled','deleting','delete_failed');
create type cmp_item_status   as enum ('pending','changed','unchanged','new','missing','redirect','error');  -- pending = queued for diff
create type review_status     as enum ('pending','approved','rejected','ignored');
create type ignore_rule_type  as enum ('url_pattern','selector','region');
create type channel_type      as enum ('email','slack');
```

## 2. Tables

### profiles
Mirror of `auth.users`, created by trigger on sign-up.

| column | type | notes |
|--------|------|-------|
| id | uuid PK | = `auth.users.id` |
| email | text unique not null | |
| full_name | text | |
| is_platform_admin | bool default false | global admin |
| disabled_at | timestamptz | soft-disable user |

### invitations
| column | type | notes |
|--------|------|-------|
| email | text not null | lower-cased |
| project_id | uuid FK projects null | null = platform-level invite (no project) |
| role | project_role | ignored when project_id null |
| invited_by | uuid FK profiles | |
| token_hash | text | sha256 of one-time token |
| expires_at | timestamptz | default now()+7 days |
| accepted_at | timestamptz | |

Sign-up is allowed only if an un-expired invitation exists for the email (enforced in a
`before insert` hook on `auth.users` or the Supabase "auth hook"; see `04-auth-and-roles.md`).

### projects  (one row = one prototype `.env`)
| column | type | default | prototype var |
|--------|------|---------|---------------|
| slug | text unique not null | from name | — |
| name | text not null | | `SITE_NAME` |
| sitemap_index | text not null | | `SITEMAP_INDEX` |
| r2_bucket | text not null | | `R2_BUCKET` |
| r2_public_url | text null | | `R2_PUBLIC_URL` |
| basic_auth_user | text null | | `BASIC_AUTH_USER` |
| basic_auth_pass_enc | text null | AES-256-GCM, see 03 §4 | `BASIC_AUTH_PASS` |
| check_redirects | bool | true | `--no-redirect-check` inverted |
| capture_concurrency | int | 2 (1..10) | `CONCURRENCY` |
| settle_ms | int | 3000 | settle wait |
| page_timeout_ms | int | 30000 | `TIMEOUT_MS` |
| max_page_height | int | 16384 | new (memory cap) |
| diff_threshold | numeric | 0.1 | `DIFF_THRESHOLD` |
| change_threshold_pct | numeric | 0.05 | `CHANGE_THRESHOLD` |
| extra_css | text null | | appended to NORMALISE_CSS |
| hide_selectors | text[] | {} | new |
| file_extensions | text[] null | null = engine default | `FILE_EXTENSIONS` |
| baseline_run_id | uuid FK runs null | | new |
| archived_at | timestamptz null | | |
| created_by | uuid FK profiles | | |

### viewports
| column | type | notes |
|--------|------|-------|
| project_id | uuid FK | |
| slug | text | `desktop`, `mobile`, … unique per project, `[a-z0-9-]+` |
| width / height | int | default desktop 1280×900 |
| device_scale_factor | numeric default 1 | |
| is_mobile | bool default false | sets mobile UA + touch |
| enabled | bool default true | |
| sort_order | int | |

New project gets `desktop 1280×900`. Suggested presets in UI: `tablet 768×1024`, `mobile 390×844 (is_mobile)`.

### project_members
PK (`project_id`, `user_id`), `role project_role`.

### sitemap_snapshots
| column | type | notes |
|--------|------|-------|
| project_id | uuid FK | |
| status | text | `running`/`completed`/`failed` |
| source_url | text | sitemap_index at fetch time |
| child_sitemaps | int | |
| url_count / redirect_count / error_count | int | |
| error | text | |
| started_by | uuid | |

### sitemap_urls
| column | type | notes |
|--------|------|-------|
| snapshot_id | uuid FK cascade | |
| url | text | |
| kind | item_kind | from extension |
| http_status | int null | from redirect check |
| redirect_to | text null | set → excluded |
| included | bool | false if redirect or excluded by rule |
| source | text | `sitemap` or `manual` |

Unique (`snapshot_id`, `url`). Manual URLs (added in UI) are stored in `project_manual_urls`
(`project_id`, `url`, `note`) and merged into every new snapshot.

### runs
| column | type | notes |
|--------|------|-------|
| project_id | uuid FK | |
| label | text not null | `YYYY-MM-DD_HH-MM-SS` UTC, unique per project |
| status | run_status | |
| snapshot_id | uuid FK null | null for legacy |
| viewport_slugs | text[] | viewports captured |
| is_legacy | bool default false | prototype layout |
| settings | jsonb | frozen copy of capture settings used |
| total_items / done_items / failed_items | int | maintained by trigger |
| note | text | user description, e.g. "before deploy 4.2" |
| workflow_id | text | Cloudflare Workflow instance id |
| started_by | uuid | |
| started_at / finished_at | timestamptz | |
| cancel_requested_at | timestamptz | |

### run_items
| column | type | notes |
|--------|------|-------|
| run_id | uuid FK cascade | |
| url | text | |
| kind | item_kind | |
| viewport_slug | text null | null for `file` |
| filename | text | engine `urlToFilename(url)` (with `.png`) |
| r2_key | text | see §3 |
| status | item_status | |
| attempts | int default 0 | |
| width / height | int | png dims |
| truncated | bool | height capped at `max_page_height` |
| bytes | bigint | |
| sha256 | text | pages: sha256 of the PNG (review memory); files: content hash or `ERROR …` |
| http_status / content_type / last_modified / etag / final_url | | file fingerprint fields |
| error | text | |
| finished_at | timestamptz | |

Unique (`run_id`, `url`, `coalesce(viewport_slug,'')`). Index (`run_id`, `status`).

### comparisons
| column | type | notes |
|--------|------|-------|
| project_id | uuid FK | |
| before_run_id / after_run_id | uuid FK | must belong to same project |
| label | text | `<before.label>_vs_<after.label>` |
| status | comparison_status | |
| settings | jsonb | thresholds + ignore rules snapshot |
| counts | jsonb | `{compared, changed, unchanged, new, missing, redirect, error, files_changed, files_total}` |
| review_counts | jsonb | `{pending, approved, rejected, ignored}` |
| report_r2_key | text null | static export |
| share_token_hash | text null | public link |
| share_expires_at | timestamptz null | |
| workflow_id / started_by / started_at / finished_at | | |

Unique (`project_id`, `before_run_id`, `after_run_id`) — re-running replaces items.

### comparison_items
| column | type | notes |
|--------|------|-------|
| comparison_id | uuid FK cascade | |
| url | text null | null if URL unknown (legacy) |
| name | text | filename without extension |
| kind | item_kind | |
| viewport_slug | text null | |
| status | cmp_item_status | |
| diff_pct | numeric null | 0–100 |
| diff_pixels / total_pixels | bigint null | |
| before_key / after_key / diff_key | text null | R2 keys |
| before_dims / after_dims | int[2] null | |
| redirect_to | text null | |
| fp_before / fp_after | jsonb null | fingerprint objects |
| review | review_status default 'pending' (only meaningful when changed) | |
| reviewed_by / reviewed_at / review_note | | |
| error | text | |

Index (`comparison_id`, `status`, `diff_pct desc`).

### review_memory
Remembers approvals so the same visual change is auto-approved next time (F-REVIEW-6).
(`project_id`, `url`, `viewport_slug`, `after_sha256` of the after PNG, `review`, `decided_by`).

### ignore_rules
| column | type | notes |
|--------|------|-------|
| project_id | uuid FK | |
| type | ignore_rule_type | |
| url_pattern | text | glob (`*`, `**`) or `re:` prefixed regex; matches full URL. Required for `url_pattern`, optional scope for others |
| selector | text | CSS selector (type `selector`): element is hidden (`visibility:hidden`) before capture |
| region | jsonb | `{x,y,width,height}` px (type `region`): masked in both images before diff |
| viewport_slug | text null | null = all viewports |
| applies_to | text | `capture`, `compare` or `both` (url_pattern only) |
| enabled | bool default true | |
| reason | text | |
| created_by | uuid | |

### notification_channels
(`project_id`, `type channel_type`, `target` text — email address or Slack webhook URL encrypted
in `target_enc` for Slack, `events text[]` ⊆ {`comparison_changed`, `comparison_clean`,
`run_failed`, `run_completed`}, `enabled`).

### notification_log
(`channel_id`, `event`, `entity_id`, `status`, `error`, `sent_at`).

### audit_log
(`actor_id`, `project_id`, `action` text e.g. `project.update`, `run.start`, `run.delete`,
`comparison.review`, `member.add`; `details jsonb`). Insert-only.

## 3. R2 key layout (per project bucket)

New runs (non-legacy):

```
screenshots/<run.label>/<viewport_slug>/<filename>.png    page screenshot
screenshots/<run.label>/_files/<filename>.txt             file fingerprint (prototype text format)
diffs/<cmp.label>/<viewport_slug>/<filename>.png          diff image (changed only)
reports/<cmp.label>/index.html                            static export (optional)
```

The static export references images directly in `screenshots/` and `diffs/` via absolute
public URLs (no copies — saves storage vs. prototype which copied before/after/diff).

Legacy prototype runs (imported, `is_legacy=true`):

```
screenshots/<ts>/<filename>.png     → viewport_slug = 'desktop'
screenshots/<ts>/<filename>.txt     → file fingerprint
```

All R2 key building lives in `packages/shared/r2-keys.ts`; no other code concatenates keys.

## 4. RLS policy summary

Helper SQL functions (security definer, stable):
`is_platform_admin()`, `project_role(project_id) returns project_role`,
`can_view(project_id)`, `can_edit(project_id)`, `can_admin(project_id)`.

| Table | select | insert/update | delete |
|-------|--------|---------------|--------|
| profiles | self, or member of a shared project, or platform admin | self (name only); admin (all) | — |
| projects | `can_view` | insert: platform admin; update: `can_admin` | platform admin |
| viewports, ignore_rules, notification_channels, project_manual_urls | `can_view` | `can_admin` (ignore_rules: `can_edit`) | same as update |
| project_members | `can_view` | `can_admin` | `can_admin` |
| sitemap_*, runs, run_items | `can_view` | `can_edit` (items written by service role) | runs: `can_admin` |
| comparisons, comparison_items | `can_view` | `can_edit`; review columns via RPC `review_items()` only | `can_admin` |
| audit_log | `can_admin` / platform admin | via trigger/RPC only | never |
| invitations | platform admin / `can_admin` of that project | same | same |

`basic_auth_pass_enc` and `notification_channels.target_enc` are never selected by the web
client; a view `projects_public` excludes them and exposes `has_basic_auth bool`.

Counters (`runs.done_items` etc.) are maintained by statement-level triggers or a
`refresh_run_counts(run_id)` function called by the worker after each batch — not by the client.
