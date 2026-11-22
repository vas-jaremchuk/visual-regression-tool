-- T15: comparisons.counts also holds the page counters per viewport (F-CMP-2, F-VIEWPORT-3):
--   counts.viewports = { "<slug>": {compared, changed, unchanged, new, missing, redirect, error} }
-- The top-level counters are unchanged. Files have no viewport and stay top-level only.
create or replace function public.refresh_comparison_counts(p_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.comparisons cmp
  set counts = c.counts || jsonb_build_object('viewports', coalesce(v.viewports, '{}'::jsonb)),
      review_counts = c.review_counts
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
  ) c,
  (
    select jsonb_object_agg(s.viewport_slug, s.counts) as viewports
    from (
      select
        i.viewport_slug,
        jsonb_build_object(
          'compared',  count(*) filter (where i.status in ('changed', 'unchanged', 'error')),
          'changed',   count(*) filter (where i.status = 'changed'),
          'unchanged', count(*) filter (where i.status = 'unchanged'),
          'new',       count(*) filter (where i.status = 'new'),
          'missing',   count(*) filter (where i.status = 'missing'),
          'redirect',  count(*) filter (where i.status = 'redirect'),
          'error',     count(*) filter (where i.status = 'error')
        ) as counts
      from public.comparison_items i
      where i.comparison_id = p_id and i.kind = 'page' and i.viewport_slug is not null
      group by i.viewport_slug
    ) s
  ) v
  where cmp.id = p_id;
$$;

revoke execute on function public.refresh_comparison_counts(uuid) from public, anon, authenticated;
grant execute on function public.refresh_comparison_counts(uuid) to service_role;
