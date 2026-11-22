-- Comparison counts (T15, F-CMP-2): totals and per-viewport page counters. Run with `pnpm test:db`.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into public.projects (id, slug, name, sitemap_index, r2_bucket)
values ('00000000-0000-0000-0000-0000000000a1', 'cmp', 'Cmp', 'https://example.test/sitemap.xml', 'bucket');

insert into public.runs (id, project_id, label, status, viewport_slugs)
values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', '2026-11-01_10-00-00', 'completed', '{desktop,mobile}'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a1', '2026-11-02_10-00-00', 'completed', '{desktop,mobile}');

insert into public.comparisons (id, project_id, before_run_id, after_run_id, label)
values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1',
        '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2',
        '2026-11-01_10-00-00_vs_2026-11-02_10-00-00');

insert into public.comparison_items (comparison_id, url, name, kind, viewport_slug, status, review)
values
  ('00000000-0000-0000-0000-0000000000c1', 'https://e.test/', 'home', 'page', 'desktop', 'changed', 'pending'),
  ('00000000-0000-0000-0000-0000000000c1', 'https://e.test/a/', 'a', 'page', 'desktop', 'unchanged', 'pending'),
  ('00000000-0000-0000-0000-0000000000c1', 'https://e.test/n/', 'n', 'page', 'desktop', 'new', 'pending'),
  ('00000000-0000-0000-0000-0000000000c1', 'https://e.test/', 'home', 'page', 'mobile', 'changed', 'approved'),
  ('00000000-0000-0000-0000-0000000000c1', 'https://e.test/r/', 'r', 'page', 'mobile', 'redirect', 'pending'),
  ('00000000-0000-0000-0000-0000000000c1', 'https://e.test/m/', 'm', 'page', 'mobile', 'missing', 'pending'),
  ('00000000-0000-0000-0000-0000000000c1', 'https://e.test/f.pdf', 'f.pdf', 'file', null, 'changed', 'pending');

select public.refresh_comparison_counts('00000000-0000-0000-0000-0000000000c1');

select is(
  (select counts - 'viewports' from public.comparisons where id = '00000000-0000-0000-0000-0000000000c1'),
  '{"compared": 3, "changed": 2, "unchanged": 1, "new": 1, "missing": 1, "redirect": 1, "error": 0,
    "files_changed": 1, "files_total": 1}'::jsonb,
  'top-level counters cover pages of every viewport and files'
);

select is(
  (select counts -> 'viewports' from public.comparisons where id = '00000000-0000-0000-0000-0000000000c1'),
  '{"desktop": {"compared": 2, "changed": 1, "unchanged": 1, "new": 1, "missing": 0, "redirect": 0, "error": 0},
    "mobile":  {"compared": 1, "changed": 1, "unchanged": 0, "new": 0, "missing": 1, "redirect": 1, "error": 0}}'::jsonb,
  'counts.viewports has the page counters per viewport'
);

select is(
  (select review_counts from public.comparisons where id = '00000000-0000-0000-0000-0000000000c1'),
  '{"pending": 2, "approved": 1, "rejected": 0, "ignored": 0}'::jsonb,
  'review counts cover changed items'
);

delete from public.comparison_items where comparison_id = '00000000-0000-0000-0000-0000000000c1';
select public.refresh_comparison_counts('00000000-0000-0000-0000-0000000000c1');
select is(
  (select counts -> 'viewports' from public.comparisons where id = '00000000-0000-0000-0000-0000000000c1'),
  '{}'::jsonb,
  'a comparison without items has no viewport counters'
);

select * from finish();
rollback;
