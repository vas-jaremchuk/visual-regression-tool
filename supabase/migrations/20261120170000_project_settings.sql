-- T08: project settings (specification/03-configuration.md §6, F-PROJ-3, F-VIEWPORT-1).
-- Forward-only (NFR-24).

-- General → notes (03 §6).
alter table public.projects add column notes text check (char_length(notes) <= 5000);
grant select (notes) on public.projects to authenticated;

create or replace view public.projects_public
with (security_barrier = true)
as
select
  p.id, p.slug, p.name, p.sitemap_index, p.r2_bucket, p.r2_public_url, p.basic_auth_user,
  p.basic_auth_pass_enc is not null as has_basic_auth,
  p.check_redirects, p.capture_concurrency, p.settle_ms, p.page_timeout_ms, p.max_page_height,
  p.diff_threshold, p.change_threshold_pct, p.extra_css, p.hide_selectors, p.file_extensions,
  p.baseline_run_id, p.archived_at, p.created_by, p.created_at, p.notes
from public.projects p
where public.can_view(p.id);

-- The project slug is part of every link and is read-only after the first run (03 §6).
create function public.projects_guard_slug()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.slug is distinct from old.slug
     and exists (select 1 from public.runs r where r.project_id = old.id)
  then
    raise exception 'The project slug cannot change after the first run'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger projects_guard_slug
  before update of slug on public.projects
  for each row execute function public.projects_guard_slug();

-- A viewport slug names R2 keys, so it cannot change or disappear once a run used it
-- (F-VIEWPORT-1); such viewports can still be disabled.
create function public.viewports_guard_used_slug()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Deleting the whole project cascades here; that is allowed.
  if (tg_op = 'DELETE' or new.slug is distinct from old.slug)
     and exists (select 1 from public.projects p where p.id = old.project_id)
     and exists (
       select 1 from public.runs r
       where r.project_id = old.project_id and old.slug = any (r.viewport_slugs)
     )
  then
    raise exception 'Viewport "%" was used in a run; its slug cannot change and it cannot be deleted', old.slug
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger viewports_guard_used_slug
  before update of slug or delete on public.viewports
  for each row execute function public.viewports_guard_used_slug();
