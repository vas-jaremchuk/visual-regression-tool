-- T02: enums, tables, indexes and constraints (specification/02-data-model.md §1–§2).
-- Forward-only: reverting means `supabase db reset` to an earlier migration set (NFR-24).

-- 1. Enums --------------------------------------------------------------------------------------

create type public.project_role      as enum ('admin', 'editor', 'viewer');
create type public.run_status        as enum ('queued', 'running', 'completed', 'completed_with_errors', 'failed', 'cancelled', 'deleting', 'delete_failed');
create type public.item_kind         as enum ('page', 'file');
create type public.item_status       as enum ('pending', 'processing', 'done', 'failed', 'skipped');
create type public.comparison_status as enum ('queued', 'running', 'completed', 'failed', 'cancelled', 'deleting', 'delete_failed');
create type public.cmp_item_status   as enum ('pending', 'changed', 'unchanged', 'new', 'missing', 'redirect', 'error');
create type public.review_status     as enum ('pending', 'approved', 'rejected', 'ignored');
create type public.ignore_rule_type  as enum ('url_pattern', 'selector', 'region');
create type public.channel_type      as enum ('email', 'slack');

-- 2. Tables -------------------------------------------------------------------------------------

create table public.profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  email             text not null unique,
  full_name         text,
  is_platform_admin boolean not null default false,
  disabled_at       timestamptz,
  created_at        timestamptz not null default now()
);

create table public.projects (
  id                   uuid primary key default gen_random_uuid(),
  slug                 text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name                 text not null,
  sitemap_index        text not null,
  r2_bucket            text not null,
  r2_public_url        text,
  basic_auth_user      text,
  basic_auth_pass_enc  text,
  check_redirects      boolean not null default true,
  capture_concurrency  int not null default 2 check (capture_concurrency between 1 and 10),
  settle_ms            int not null default 3000 check (settle_ms >= 0),
  page_timeout_ms      int not null default 30000 check (page_timeout_ms > 0),
  max_page_height      int not null default 16384 check (max_page_height > 0),
  diff_threshold       numeric not null default 0.1 check (diff_threshold between 0 and 1),
  change_threshold_pct numeric not null default 0.05 check (change_threshold_pct between 0 and 100),
  extra_css            text,
  hide_selectors       text[] not null default '{}',
  file_extensions      text[],
  baseline_run_id      uuid, -- FK added after `runs` exists
  archived_at          timestamptz,
  created_by           uuid references public.profiles (id) on delete set null,
  created_at           timestamptz not null default now()
);

create table public.invitations (
  id          uuid primary key default gen_random_uuid(),
  email       text not null check (email = lower(email)),
  project_id  uuid references public.projects (id) on delete cascade,
  role        public.project_role,
  invited_by  uuid references public.profiles (id) on delete set null,
  token_hash  text,
  expires_at  timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at  timestamptz not null default now()
);
create index invitations_email_idx on public.invitations (email);
create index invitations_project_id_idx on public.invitations (project_id);
create unique index invitations_token_hash_key on public.invitations (token_hash);

create table public.viewports (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.projects (id) on delete cascade,
  slug                text not null check (slug ~ '^[a-z0-9-]+$'),
  width               int not null default 1280 check (width > 0),
  height              int not null default 900 check (height > 0),
  device_scale_factor numeric not null default 1 check (device_scale_factor > 0),
  is_mobile           boolean not null default false,
  enabled             boolean not null default true,
  sort_order          int not null default 0,
  created_at          timestamptz not null default now(),
  unique (project_id, slug)
);

create table public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  role       public.project_role not null,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index project_members_user_id_idx on public.project_members (user_id);

create table public.sitemap_snapshots (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects (id) on delete cascade,
  status         text not null default 'running' check (status in ('running', 'completed', 'failed')),
  source_url     text not null,
  child_sitemaps int not null default 0,
  url_count      int not null default 0,
  redirect_count int not null default 0,
  error_count    int not null default 0,
  error          text,
  started_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now()
);
create index sitemap_snapshots_project_id_idx on public.sitemap_snapshots (project_id, created_at desc);

create table public.sitemap_urls (
  id          uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.sitemap_snapshots (id) on delete cascade,
  url         text not null,
  kind        public.item_kind not null,
  http_status int,
  redirect_to text,
  included    boolean not null default true,
  source      text not null default 'sitemap' check (source in ('sitemap', 'manual')),
  created_at  timestamptz not null default now(),
  unique (snapshot_id, url)
);

create table public.project_manual_urls (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  url        text not null,
  note       text,
  created_at timestamptz not null default now(),
  unique (project_id, url)
);

create table public.runs (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references public.projects (id) on delete cascade,
  label               text not null,
  status              public.run_status not null default 'queued',
  snapshot_id         uuid references public.sitemap_snapshots (id) on delete set null,
  viewport_slugs      text[] not null default '{}',
  is_legacy           boolean not null default false,
  settings            jsonb not null default '{}',
  total_items         int not null default 0,
  done_items          int not null default 0,
  failed_items        int not null default 0,
  note                text,
  workflow_id         text,
  started_by          uuid references public.profiles (id) on delete set null,
  started_at          timestamptz,
  finished_at         timestamptz,
  cancel_requested_at timestamptz,
  created_at          timestamptz not null default now(),
  unique (project_id, label),
  unique (project_id, id) -- target for same-project foreign keys
);

alter table public.projects
  add constraint projects_baseline_run_id_fkey
  foreign key (id, baseline_run_id) references public.runs (project_id, id) on delete set null (baseline_run_id);

create table public.run_items (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null references public.runs (id) on delete cascade,
  url           text not null,
  kind          public.item_kind not null,
  viewport_slug text,
  filename      text not null,
  r2_key        text,
  status        public.item_status not null default 'pending',
  attempts      int not null default 0,
  width         int,
  height        int,
  truncated     boolean not null default false,
  bytes         bigint,
  sha256        text,
  http_status   int,
  content_type  text,
  last_modified text,
  etag          text,
  final_url     text,
  error         text,
  finished_at   timestamptz,
  created_at    timestamptz not null default now()
);
create unique index run_items_run_url_viewport_key on public.run_items (run_id, url, coalesce(viewport_slug, ''));
create index run_items_run_id_status_idx on public.run_items (run_id, status);

create table public.comparisons (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects (id) on delete cascade,
  before_run_id    uuid not null,
  after_run_id     uuid not null,
  label            text not null,
  status           public.comparison_status not null default 'queued',
  settings         jsonb not null default '{}',
  counts           jsonb not null default '{}',
  review_counts    jsonb not null default '{}',
  report_r2_key    text,
  share_token_hash text unique,
  share_expires_at timestamptz,
  workflow_id      text,
  started_by       uuid references public.profiles (id) on delete set null,
  started_at       timestamptz,
  finished_at      timestamptz,
  created_at       timestamptz not null default now(),
  -- both runs must belong to the comparison's project
  foreign key (project_id, before_run_id) references public.runs (project_id, id) on delete cascade,
  foreign key (project_id, after_run_id) references public.runs (project_id, id) on delete cascade,
  unique (project_id, before_run_id, after_run_id)
);
create index comparisons_after_run_id_idx on public.comparisons (after_run_id);
create index comparisons_before_run_id_idx on public.comparisons (before_run_id);

create table public.comparison_items (
  id            uuid primary key default gen_random_uuid(),
  comparison_id uuid not null references public.comparisons (id) on delete cascade,
  url           text,
  name          text not null,
  kind          public.item_kind not null,
  viewport_slug text,
  status        public.cmp_item_status not null default 'pending',
  diff_pct      numeric check (diff_pct between 0 and 100),
  diff_pixels   bigint,
  total_pixels  bigint,
  before_key    text,
  after_key     text,
  diff_key      text,
  before_dims   int[] check (before_dims is null or cardinality(before_dims) = 2),
  after_dims    int[] check (after_dims is null or cardinality(after_dims) = 2),
  redirect_to   text,
  fp_before     jsonb,
  fp_after      jsonb,
  review        public.review_status not null default 'pending',
  reviewed_by   uuid references public.profiles (id) on delete set null,
  reviewed_at   timestamptz,
  review_note   text,
  error         text,
  created_at    timestamptz not null default now()
);
create index comparison_items_comparison_status_diff_idx on public.comparison_items (comparison_id, status, diff_pct desc);

create table public.review_memory (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects (id) on delete cascade,
  url           text not null,
  viewport_slug text,
  after_sha256  text not null,
  review        public.review_status not null,
  decided_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now()
);
create unique index review_memory_key on public.review_memory (project_id, url, coalesce(viewport_slug, ''), after_sha256);

create table public.ignore_rules (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects (id) on delete cascade,
  type          public.ignore_rule_type not null,
  url_pattern   text,
  selector      text,
  region        jsonb,
  viewport_slug text,
  applies_to    text not null default 'both' check (applies_to in ('capture', 'compare', 'both')),
  enabled       boolean not null default true,
  reason        text,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  check (type <> 'url_pattern' or url_pattern is not null),
  check (type <> 'selector' or selector is not null),
  check (type <> 'region' or region is not null)
);
create index ignore_rules_project_id_idx on public.ignore_rules (project_id);

create table public.notification_channels (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  type       public.channel_type not null,
  target     text, -- email address (type email)
  target_enc text, -- encrypted Slack webhook URL (type slack)
  events     text[] not null default '{}'
    check (events <@ array['comparison_changed', 'comparison_clean', 'run_failed', 'run_completed']),
  enabled    boolean not null default true,
  created_at timestamptz not null default now()
);
create index notification_channels_project_id_idx on public.notification_channels (project_id);

create table public.notification_log (
  id         uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.notification_channels (id) on delete cascade,
  event      text not null,
  entity_id  uuid,
  status     text not null,
  error      text,
  sent_at    timestamptz,
  created_at timestamptz not null default now()
);
create index notification_log_channel_id_idx on public.notification_log (channel_id, created_at desc);

create table public.audit_log (
  id         uuid primary key default gen_random_uuid(),
  actor_id   uuid references public.profiles (id) on delete set null,
  project_id uuid references public.projects (id) on delete set null,
  action     text not null,
  details    jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_log_project_id_idx on public.audit_log (project_id, created_at desc);

-- Indexes for remaining foreign keys used by RLS / cascades.
create index runs_project_id_idx on public.runs (project_id, created_at desc);
create index comparisons_project_id_idx on public.comparisons (project_id, created_at desc);
create index review_memory_project_id_idx on public.review_memory (project_id);

-- 3. Profiles mirror auth.users -----------------------------------------------------------------

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, lower(new.email), new.raw_user_meta_data ->> 'full_name');
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
