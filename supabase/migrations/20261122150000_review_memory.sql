-- T20 (F-REVIEW-6): review memory. `review_items` remembers each decision on a changed page under
-- (url, viewport, sha256 of the after PNG); the compare workflow's auto-review step applies an
-- approved/ignored memory to later comparisons with the note `auto: same as <review> in <label>`.

-- Where the decision was taken, for that note. The label is kept when the comparison is deleted.
alter table public.review_memory
  add column comparison_id uuid references public.comparisons (id) on delete set null,
  add column comparison_label text;
create index review_memory_comparison_id_idx on public.review_memory (comparison_id);

-- Same signature and grants as T18. A later decision on the same after PNG replaces the earlier
-- one, so rejecting an auto-approved item stops it being auto-approved again. Resetting to pending
-- forgets what this comparison remembered for the items.
create or replace function public.review_items(
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
  v_after_run_id uuid;
  v_label text;
  v_count integer;
begin
  select project_id, after_run_id, label into v_project_id, v_after_run_id, v_label
  from public.comparisons where id = p_comparison_id;
  if v_project_id is null or not public.can_edit(v_project_id) then
    raise exception 'permission denied' using errcode = 'insufficient_privilege';
  end if;

  update public.comparison_items
  set review      = p_review,
      review_note = p_note,
      reviewed_by = case when p_review = 'pending' then null else auth.uid() end,
      reviewed_at = case when p_review = 'pending' then null else now() end
  where comparison_id = p_comparison_id and id = any (p_item_ids) and status = 'changed';
  get diagnostics v_count = row_count;

  if p_review = 'pending' then
    delete from public.review_memory m
    using public.comparison_items ci
    where ci.comparison_id = p_comparison_id and ci.id = any (p_item_ids)
      and ci.status = 'changed' and ci.kind = 'page'
      and m.project_id = v_project_id and m.comparison_id = p_comparison_id
      and m.url = ci.url and m.viewport_slug is not distinct from ci.viewport_slug;
  else
    insert into public.review_memory
      (project_id, url, viewport_slug, after_sha256, review, decided_by, comparison_id, comparison_label)
    select distinct on (ci.url, coalesce(ci.viewport_slug, ''))
           v_project_id, ci.url, ci.viewport_slug, ri.sha256, p_review, auth.uid(),
           p_comparison_id, v_label
    from public.comparison_items ci
    join public.run_items ri
      on ri.run_id = v_after_run_id and ri.kind = 'page' and ri.url = ci.url
     and ri.viewport_slug is not distinct from ci.viewport_slug
    where ci.comparison_id = p_comparison_id and ci.id = any (p_item_ids)
      and ci.status = 'changed' and ci.kind = 'page' and ci.url is not null
      and ri.sha256 is not null
    on conflict (project_id, url, coalesce(viewport_slug, ''), after_sha256) do update
      set review           = excluded.review,
          decided_by       = excluded.decided_by,
          comparison_id    = excluded.comparison_id,
          comparison_label = excluded.comparison_label,
          created_at       = now();
  end if;

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
