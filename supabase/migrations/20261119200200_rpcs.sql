-- T02: database RPCs (specification/09-api.md §5) and the audit writer.
-- Forward-only (NFR-24).

-- Insert-only audit entry for the current user. Server actions call this after every mutation;
-- the other RPCs call it directly.
create function public.write_audit_log(p_action text, p_project_id uuid default null, p_details jsonb default '{}')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;
  if p_project_id is null then
    if not public.is_platform_admin() then
      raise exception 'permission denied' using errcode = 'insufficient_privilege';
    end if;
  elsif not public.can_view(p_project_id) then
    raise exception 'permission denied' using errcode = 'insufficient_privilege';
  end if;

  insert into public.audit_log (actor_id, project_id, action, details)
  values (auth.uid(), p_project_id, p_action, coalesce(p_details, '{}'))
  returning id into v_id;
  return v_id;
end;
$$;

-- Recomputes runs.total_items / done_items / failed_items from run_items. Worker only.
create function public.refresh_run_counts(p_run_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.runs r
  set total_items  = c.total,
      done_items   = c.done,
      failed_items = c.failed
  from (
    select count(*)::int as total,
           count(*) filter (where status = 'done')::int as done,
           count(*) filter (where status = 'failed')::int as failed
    from public.run_items
    where run_id = p_run_id
  ) c
  where r.id = p_run_id;
$$;

-- Recomputes comparisons.counts and review_counts from comparison_items. Page counters count
-- pages only; files are reported as files_changed / files_total. Review counts cover changed items.
create function public.refresh_comparison_counts(p_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.comparisons cmp
  set counts = c.counts, review_counts = c.review_counts
  from (
    select
      jsonb_build_object(
        'compared',      count(*) filter (where i.kind = 'page' and i.status in ('changed', 'unchanged', 'error')),
        'changed',       count(*) filter (where i.kind = 'page' and i.status = 'changed'),
        'unchanged',     count(*) filter (where i.kind = 'page' and i.status = 'unchanged'),
        'new',           count(*) filter (where i.kind = 'page' and i.status = 'new'),
        'missing',       count(*) filter (where i.kind = 'page' and i.status = 'missing'),
        'redirect',      count(*) filter (where i.kind = 'page' and i.status = 'redirect'),
        'error',         count(*) filter (where i.kind = 'page' and i.status = 'error'),
        'files_changed', count(*) filter (where i.kind = 'file' and i.status = 'changed'),
        'files_total',   count(*) filter (where i.kind = 'file')
      ) as counts,
      jsonb_build_object(
        'pending',  count(*) filter (where i.status = 'changed' and i.review = 'pending'),
        'approved', count(*) filter (where i.status = 'changed' and i.review = 'approved'),
        'rejected', count(*) filter (where i.status = 'changed' and i.review = 'rejected'),
        'ignored',  count(*) filter (where i.status = 'changed' and i.review = 'ignored')
      ) as review_counts
    from public.comparison_items i
    where i.comparison_id = p_id
  ) c
  where cmp.id = p_id;
$$;

-- Sets the project's baseline run. Editors and above; the run must have completed.
create function public.set_baseline(p_project_id uuid, p_run_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.run_status;
begin
  if not public.can_edit(p_project_id) then
    raise exception 'permission denied' using errcode = 'insufficient_privilege';
  end if;

  select status into v_status from public.runs where id = p_run_id and project_id = p_project_id;
  if not found then
    raise exception 'run % not found in project %', p_run_id, p_project_id using errcode = 'no_data_found';
  end if;
  if v_status not in ('completed', 'completed_with_errors') then
    raise exception 'run % is %, only completed runs can be the baseline', p_run_id, v_status
      using errcode = 'check_violation';
  end if;

  update public.projects set baseline_run_id = p_run_id where id = p_project_id;
  perform public.write_audit_log('project.set_baseline', p_project_id, jsonb_build_object('run_id', p_run_id));
end;
$$;

-- Sets the review of items in one comparison. Editors and above. Returns the number of items
-- updated. Review memory (F-REVIEW-6) is added in T20.
create function public.review_items(
  p_comparison_id uuid,
  p_item_ids uuid[],
  p_review public.review_status,
  p_note text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_count integer;
begin
  select project_id into v_project_id from public.comparisons where id = p_comparison_id;
  if v_project_id is null or not public.can_edit(v_project_id) then
    raise exception 'permission denied' using errcode = 'insufficient_privilege';
  end if;

  update public.comparison_items
  set review      = p_review,
      review_note = p_note,
      reviewed_by = case when p_review = 'pending' then null else auth.uid() end,
      reviewed_at = case when p_review = 'pending' then null else now() end
  where comparison_id = p_comparison_id and id = any (p_item_ids);
  get diagnostics v_count = row_count;

  perform public.refresh_comparison_counts(p_comparison_id);
  perform public.write_audit_log(
    'comparison.review',
    v_project_id,
    jsonb_build_object('comparison_id', p_comparison_id, 'item_ids', to_jsonb(p_item_ids),
                       'review', p_review, 'note', p_note, 'updated', v_count)
  );
  return v_count;
end;
$$;

-- Public share links: returns the comparison id when sha256(token) (lower-case hex) matches a
-- comparison whose link has not expired, else null.
create function public.resolve_share_token(p_token text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id
  from public.comparisons
  where p_token is not null
    and share_token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
    and (share_expires_at is null or share_expires_at > now());
$$;

revoke execute on function
  public.write_audit_log(text, uuid, jsonb),
  public.refresh_run_counts(uuid),
  public.refresh_comparison_counts(uuid),
  public.set_baseline(uuid, uuid),
  public.review_items(uuid, uuid[], public.review_status, text),
  public.resolve_share_token(text)
  from public, anon, authenticated;

grant execute on function public.refresh_run_counts(uuid), public.refresh_comparison_counts(uuid)
  to service_role;
grant execute on function
  public.write_audit_log(text, uuid, jsonb),
  public.set_baseline(uuid, uuid),
  public.review_items(uuid, uuid[], public.review_status, text)
  to authenticated, service_role;
grant execute on function public.resolve_share_token(text) to anon, authenticated, service_role;
