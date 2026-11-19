-- T02: permission helpers, RLS policies and column privileges (02 §4, 04 §2–§3, NFR-11).
-- Forward-only (NFR-24).

-- 1. Helpers ------------------------------------------------------------------------------------
-- security definer so they can read profiles / project_members without recursing into RLS.
-- Disabled users (profiles.disabled_at) have no rights at all.

create function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select p.is_platform_admin and p.disabled_at is null
    from public.profiles p
    where p.id = auth.uid()
  ), false);
$$;

create function public.project_role(p_project_id uuid)
returns public.project_role
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.project_members m
  join public.profiles p on p.id = m.user_id
  where m.project_id = p_project_id
    and m.user_id = auth.uid()
    and p.disabled_at is null;
$$;

create function public.can_view(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_platform_admin() or public.project_role(p_project_id) is not null;
$$;

create function public.can_edit(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_platform_admin()
    or coalesce(public.project_role(p_project_id) in ('admin', 'editor'), false);
$$;

create function public.can_admin(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_platform_admin()
    or coalesce(public.project_role(p_project_id) = 'admin', false);
$$;

-- True when the current user and p_user_id are members of at least one common project.
create function public.shares_project(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.project_members mine
    join public.project_members theirs on theirs.project_id = mine.project_id
    where mine.user_id = auth.uid() and theirs.user_id = p_user_id
  );
$$;

revoke execute on function
  public.is_platform_admin(), public.project_role(uuid), public.can_view(uuid),
  public.can_edit(uuid), public.can_admin(uuid), public.shares_project(uuid)
  from public, anon;
grant execute on function
  public.is_platform_admin(), public.project_role(uuid), public.can_view(uuid),
  public.can_edit(uuid), public.can_admin(uuid), public.shares_project(uuid)
  to authenticated, service_role;

-- 2. Table privileges ---------------------------------------------------------------------------
-- Anonymous visitors never read tables directly (public share links go through
-- resolve_share_token + the server). Authenticated users are filtered by RLS below.

revoke all on all tables in schema public from anon;

-- Encrypted columns are never selectable by web clients (02 §4, NFR-12); the worker reads them
-- with the service role.
revoke select on public.projects from authenticated;
grant select (
  id, slug, name, sitemap_index, r2_bucket, r2_public_url, basic_auth_user, check_redirects,
  capture_concurrency, settle_ms, page_timeout_ms, max_page_height, diff_threshold,
  change_threshold_pct, extra_css, hide_selectors, file_extensions, baseline_run_id,
  archived_at, created_by, created_at
) on public.projects to authenticated;

revoke select on public.notification_channels from authenticated;
grant select (id, project_id, type, target, events, enabled, created_at)
  on public.notification_channels to authenticated;

-- Review columns change only through review_items() (02 §4).
revoke update on public.comparison_items from authenticated;
grant update (
  url, name, kind, viewport_slug, status, diff_pct, diff_pixels, total_pixels, before_key,
  after_key, diff_key, before_dims, after_dims, redirect_to, fp_before, fp_after, error
) on public.comparison_items to authenticated;

-- audit_log is written by RPCs / triggers only and is never changed.
revoke insert, update, delete, truncate on public.audit_log from authenticated;

-- 3. RLS ----------------------------------------------------------------------------------------

alter table public.profiles              enable row level security;
alter table public.invitations           enable row level security;
alter table public.projects              enable row level security;
alter table public.viewports             enable row level security;
alter table public.project_members       enable row level security;
alter table public.sitemap_snapshots     enable row level security;
alter table public.sitemap_urls          enable row level security;
alter table public.project_manual_urls   enable row level security;
alter table public.runs                  enable row level security;
alter table public.run_items             enable row level security;
alter table public.comparisons           enable row level security;
alter table public.comparison_items      enable row level security;
alter table public.review_memory         enable row level security;
alter table public.ignore_rules          enable row level security;
alter table public.notification_channels enable row level security;
alter table public.notification_log      enable row level security;
alter table public.audit_log             enable row level security;

-- profiles: self, co-members, platform admin. Users may change only their own full_name
-- (enforced by the trigger below); platform admins may change everything. No deletes.
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.is_platform_admin() or public.shares_project(id));
create policy profiles_insert on public.profiles for insert to authenticated
  with check (public.is_platform_admin());
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid()) or public.is_platform_admin())
  with check (id = (select auth.uid()) or public.is_platform_admin());

create function public.profiles_guard_self_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated' and not public.is_platform_admin()
     and (new.id, new.email, new.is_platform_admin, new.disabled_at, new.created_at)
         is distinct from (old.id, old.email, old.is_platform_admin, old.disabled_at, old.created_at)
  then
    raise exception 'only full_name can be changed on your own profile'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger profiles_guard_self_update
  before update on public.profiles
  for each row execute function public.profiles_guard_self_update();

-- projects
create policy projects_select on public.projects for select to authenticated
  using (public.can_view(id));
create policy projects_insert on public.projects for insert to authenticated
  with check (public.is_platform_admin());
create policy projects_update on public.projects for update to authenticated
  using (public.can_admin(id)) with check (public.can_admin(id));
create policy projects_delete on public.projects for delete to authenticated
  using (public.is_platform_admin());

-- Project-scoped settings: view for members, write for project admins.
create policy viewports_select on public.viewports for select to authenticated
  using (public.can_view(project_id));
create policy viewports_insert on public.viewports for insert to authenticated
  with check (public.can_admin(project_id));
create policy viewports_update on public.viewports for update to authenticated
  using (public.can_admin(project_id)) with check (public.can_admin(project_id));
create policy viewports_delete on public.viewports for delete to authenticated
  using (public.can_admin(project_id));

create policy notification_channels_select on public.notification_channels for select to authenticated
  using (public.can_view(project_id));
create policy notification_channels_insert on public.notification_channels for insert to authenticated
  with check (public.can_admin(project_id));
create policy notification_channels_update on public.notification_channels for update to authenticated
  using (public.can_admin(project_id)) with check (public.can_admin(project_id));
create policy notification_channels_delete on public.notification_channels for delete to authenticated
  using (public.can_admin(project_id));

create policy project_members_select on public.project_members for select to authenticated
  using (public.can_view(project_id));
create policy project_members_insert on public.project_members for insert to authenticated
  with check (public.can_admin(project_id));
create policy project_members_update on public.project_members for update to authenticated
  using (public.can_admin(project_id)) with check (public.can_admin(project_id));
create policy project_members_delete on public.project_members for delete to authenticated
  using (public.can_admin(project_id));

-- Editor-level project data (04 §3: editors manage ignore rules and add manual URLs).
create policy ignore_rules_select on public.ignore_rules for select to authenticated
  using (public.can_view(project_id));
create policy ignore_rules_insert on public.ignore_rules for insert to authenticated
  with check (public.can_edit(project_id));
create policy ignore_rules_update on public.ignore_rules for update to authenticated
  using (public.can_edit(project_id)) with check (public.can_edit(project_id));
create policy ignore_rules_delete on public.ignore_rules for delete to authenticated
  using (public.can_edit(project_id));

create policy project_manual_urls_select on public.project_manual_urls for select to authenticated
  using (public.can_view(project_id));
create policy project_manual_urls_insert on public.project_manual_urls for insert to authenticated
  with check (public.can_edit(project_id));
create policy project_manual_urls_update on public.project_manual_urls for update to authenticated
  using (public.can_edit(project_id)) with check (public.can_edit(project_id));
create policy project_manual_urls_delete on public.project_manual_urls for delete to authenticated
  using (public.can_edit(project_id));

-- Sitemaps, runs, comparisons: view for members, write for editors, delete for project admins.
create policy sitemap_snapshots_select on public.sitemap_snapshots for select to authenticated
  using (public.can_view(project_id));
create policy sitemap_snapshots_insert on public.sitemap_snapshots for insert to authenticated
  with check (public.can_edit(project_id));
create policy sitemap_snapshots_update on public.sitemap_snapshots for update to authenticated
  using (public.can_edit(project_id)) with check (public.can_edit(project_id));
create policy sitemap_snapshots_delete on public.sitemap_snapshots for delete to authenticated
  using (public.can_admin(project_id));

create function public.snapshot_project_id(p_snapshot_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select project_id from public.sitemap_snapshots where id = p_snapshot_id;
$$;

create policy sitemap_urls_select on public.sitemap_urls for select to authenticated
  using (public.can_view(public.snapshot_project_id(snapshot_id)));
create policy sitemap_urls_insert on public.sitemap_urls for insert to authenticated
  with check (public.can_edit(public.snapshot_project_id(snapshot_id)));
create policy sitemap_urls_update on public.sitemap_urls for update to authenticated
  using (public.can_edit(public.snapshot_project_id(snapshot_id)))
  with check (public.can_edit(public.snapshot_project_id(snapshot_id)));
create policy sitemap_urls_delete on public.sitemap_urls for delete to authenticated
  using (public.can_admin(public.snapshot_project_id(snapshot_id)));

create policy runs_select on public.runs for select to authenticated
  using (public.can_view(project_id));
create policy runs_insert on public.runs for insert to authenticated
  with check (public.can_edit(project_id));
create policy runs_update on public.runs for update to authenticated
  using (public.can_edit(project_id)) with check (public.can_edit(project_id));
create policy runs_delete on public.runs for delete to authenticated
  using (public.can_admin(project_id));

create function public.run_project_id(p_run_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select project_id from public.runs where id = p_run_id;
$$;

create policy run_items_select on public.run_items for select to authenticated
  using (public.can_view(public.run_project_id(run_id)));
create policy run_items_insert on public.run_items for insert to authenticated
  with check (public.can_edit(public.run_project_id(run_id)));
create policy run_items_update on public.run_items for update to authenticated
  using (public.can_edit(public.run_project_id(run_id)))
  with check (public.can_edit(public.run_project_id(run_id)));
create policy run_items_delete on public.run_items for delete to authenticated
  using (public.can_admin(public.run_project_id(run_id)));

create policy comparisons_select on public.comparisons for select to authenticated
  using (public.can_view(project_id));
create policy comparisons_insert on public.comparisons for insert to authenticated
  with check (public.can_edit(project_id));
create policy comparisons_update on public.comparisons for update to authenticated
  using (public.can_edit(project_id)) with check (public.can_edit(project_id));
create policy comparisons_delete on public.comparisons for delete to authenticated
  using (public.can_admin(project_id));

create function public.comparison_project_id(p_comparison_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select project_id from public.comparisons where id = p_comparison_id;
$$;

create policy comparison_items_select on public.comparison_items for select to authenticated
  using (public.can_view(public.comparison_project_id(comparison_id)));
create policy comparison_items_insert on public.comparison_items for insert to authenticated
  with check (public.can_edit(public.comparison_project_id(comparison_id)));
create policy comparison_items_update on public.comparison_items for update to authenticated
  using (public.can_edit(public.comparison_project_id(comparison_id)))
  with check (public.can_edit(public.comparison_project_id(comparison_id)));
create policy comparison_items_delete on public.comparison_items for delete to authenticated
  using (public.can_admin(public.comparison_project_id(comparison_id)));

-- review_memory is written by review_items() only.
create policy review_memory_select on public.review_memory for select to authenticated
  using (public.can_view(project_id));

-- notification_log is written by the worker (service role); project admins can read it.
create function public.channel_project_id(p_channel_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select project_id from public.notification_channels where id = p_channel_id;
$$;

create policy notification_log_select on public.notification_log for select to authenticated
  using (public.can_admin(public.channel_project_id(channel_id)));

-- audit_log: read by project admins (their projects) and platform admins; insert-only via RPC.
create policy audit_log_select on public.audit_log for select to authenticated
  using (public.is_platform_admin() or (project_id is not null and public.can_admin(project_id)));

-- invitations: platform admins, and project admins for their project's invitations.
create policy invitations_select on public.invitations for select to authenticated
  using (public.is_platform_admin() or (project_id is not null and public.can_admin(project_id)));
create policy invitations_insert on public.invitations for insert to authenticated
  with check (public.is_platform_admin() or (project_id is not null and public.can_admin(project_id)));
create policy invitations_update on public.invitations for update to authenticated
  using (public.is_platform_admin() or (project_id is not null and public.can_admin(project_id)))
  with check (public.is_platform_admin() or (project_id is not null and public.can_admin(project_id)));
create policy invitations_delete on public.invitations for delete to authenticated
  using (public.is_platform_admin() or (project_id is not null and public.can_admin(project_id)));

revoke execute on function
  public.snapshot_project_id(uuid), public.run_project_id(uuid),
  public.comparison_project_id(uuid), public.channel_project_id(uuid)
  from public, anon;
grant execute on function
  public.snapshot_project_id(uuid), public.run_project_id(uuid),
  public.comparison_project_id(uuid), public.channel_project_id(uuid)
  to authenticated, service_role;

-- 4. projects_public ----------------------------------------------------------------------------
-- Runs as the view owner so it can expose has_basic_auth without granting the encrypted column;
-- rows are filtered explicitly with can_view().

create view public.projects_public
with (security_barrier = true)
as
select
  p.id, p.slug, p.name, p.sitemap_index, p.r2_bucket, p.r2_public_url, p.basic_auth_user,
  p.basic_auth_pass_enc is not null as has_basic_auth,
  p.check_redirects, p.capture_concurrency, p.settle_ms, p.page_timeout_ms, p.max_page_height,
  p.diff_threshold, p.change_threshold_pct, p.extra_css, p.hide_selectors, p.file_extensions,
  p.baseline_run_id, p.archived_at, p.created_by, p.created_at
from public.projects p
where public.can_view(p.id);

revoke all on public.projects_public from public, anon, authenticated;
grant select on public.projects_public to authenticated, service_role;
