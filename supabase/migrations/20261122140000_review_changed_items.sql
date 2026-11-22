-- T18 (F-REVIEW-1/2): only `changed` items carry a review, so bulk review of a filtered selection
-- that also holds unchanged/new/missing items leaves those untouched. Same signature, grants kept.
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
  where comparison_id = p_comparison_id and id = any (p_item_ids) and status = 'changed';
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

-- The report subscribes to its `comparisons` row so review counts stay live while several people
-- review (T18). RLS (comparisons_select) applies to Realtime postgres_changes too.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public'
                       and tablename = 'comparisons') then
    alter publication supabase_realtime add table public.comparisons;
  end if;
end;
$$;
