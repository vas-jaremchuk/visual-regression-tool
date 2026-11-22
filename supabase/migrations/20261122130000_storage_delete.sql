-- T22: storage accounting cache (F-STORAGE-1/4), per-run sizes (F-STORAGE-2) and the baseline
-- guard for deleting runs (F-RUN-4, F-STORAGE-3).

-- 1. storage_usage: one row per project, written by StorageWorkflow (service role) -------------
create table public.storage_usage (
  project_id   uuid primary key references public.projects (id) on delete cascade,
  bucket       text not null,
  status       text not null default 'running' check (status in ('running', 'completed', 'failed')),
  total_bytes  bigint not null default 0,
  object_count bigint not null default 0,
  -- [{prefix: 'screenshots'|'diffs'|'reports'|'other', bytes, objects}]
  groups       jsonb not null default '[]'::jsonb,
  error        text,
  workflow_id  text,
  refreshed_at timestamptz,
  updated_at   timestamptz not null default now()
);

alter table public.storage_usage enable row level security;
revoke all on public.storage_usage from anon;
revoke insert, update, delete, truncate on public.storage_usage from authenticated;

-- The storage page is for project admins (08 §1); the admin page lists every project.
create policy storage_usage_select on public.storage_usage for select to authenticated
  using (public.can_admin(project_id));

-- 2. run_sizes: bytes per run from its items, filtered by the runs/run_items RLS of the caller ---
create view public.run_sizes with (security_invoker = true) as
  select run_id, coalesce(sum(bytes), 0)::bigint as bytes, count(bytes)::int as objects
  from public.run_items
  group by run_id;

revoke all on public.run_sizes from anon;
grant select on public.run_sizes to authenticated, service_role;

-- 3. The baseline run cannot be deleted until the baseline changes. Deleting the whole project
-- removes the project row first, so its cascade to runs passes.
create function public.prevent_baseline_run_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.projects p where p.id = old.project_id and p.baseline_run_id = old.id
  ) then
    raise exception 'run % is the project baseline; set another baseline first', old.label
      using errcode = 'check_violation';
  end if;
  return old;
end;
$$;

create trigger runs_prevent_baseline_delete
  before delete on public.runs
  for each row execute function public.prevent_baseline_run_delete();
