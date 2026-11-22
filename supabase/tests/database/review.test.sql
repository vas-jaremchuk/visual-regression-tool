-- Review actions (T18, F-REVIEW-1/2, 09 §5 review_items). Run with `pnpm test:db`.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create schema tests;

-- Runs p_sql as p_user and returns its single value as text; effects are kept.
create function tests.run_as(p_user uuid, p_sql text)
returns text
language plpgsql
as $$
declare
  v text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  execute p_sql into v;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  return v;
exception when others then
  perform set_config('role', 'postgres', true);
  raise;
end;
$$;

-- d1 viewer, d2 editor
insert into auth.users (id, email, aud, role)
values
  ('00000000-0000-0000-0000-0000000000d1', 'viewer@test.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000d2', 'editor@test.local', 'authenticated', 'authenticated');

insert into public.projects (id, slug, name, sitemap_index, r2_bucket)
values ('00000000-0000-0000-0000-0000000000a1', 'review', 'Review', 'https://example.test/sitemap.xml', 'bucket');
insert into public.project_members (project_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', 'viewer'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d2', 'editor');

insert into public.runs (id, project_id, label, status) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', '2026-11-01_10-00-00', 'completed'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a1', '2026-11-02_10-00-00', 'completed');
insert into public.comparisons (id, project_id, before_run_id, after_run_id, label, status)
values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1',
        '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2',
        '2026-11-01_10-00-00_vs_2026-11-02_10-00-00', 'completed');

-- 200 changed pages and one unchanged page.
insert into public.comparison_items (comparison_id, url, name, kind, viewport_slug, status, diff_pct)
select '00000000-0000-0000-0000-0000000000c1', 'https://example.test/p' || n, 'p' || n, 'page',
       'desktop', 'changed', 1.5
from generate_series(1, 200) as n;
insert into public.comparison_items (id, comparison_id, url, name, kind, viewport_slug, status, diff_pct)
values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000c1',
        'https://example.test/same', 'same', 'page', 'desktop', 'unchanged', 0);
select public.refresh_comparison_counts('00000000-0000-0000-0000-0000000000c1');

create temporary table selection on commit drop as
  select array_agg(id) as ids from public.comparison_items
  where comparison_id = '00000000-0000-0000-0000-0000000000c1';
grant select on selection to authenticated;

select throws_ok(
  $$select tests.run_as('00000000-0000-0000-0000-0000000000d1',
    $q$select public.review_items('00000000-0000-0000-0000-0000000000c1', (select ids from selection), 'approved', null)::text$q$)$$,
  '42501', null,
  'viewer cannot review'
);

create temporary table timing (started timestamptz, updated text, finished timestamptz) on commit drop;
insert into timing (started) values (clock_timestamp());
update timing set updated = tests.run_as('00000000-0000-0000-0000-0000000000d2',
  $q$select public.review_items('00000000-0000-0000-0000-0000000000c1', (select ids from selection), 'approved', 'bulk')::text$q$);
update timing set finished = clock_timestamp();

select is((select updated from timing), '200', 'bulk review updates the 200 changed items only');
select ok(
  (select finished - started < interval '2 seconds' from timing),
  'bulk approve of 200 items takes less than 2 s'
);
select is(
  (select review::text from public.comparison_items where id = '00000000-0000-0000-0000-0000000000e1'),
  'pending',
  'unchanged items in the selection keep their review'
);
select is(
  (select review_counts from public.comparisons where id = '00000000-0000-0000-0000-0000000000c1'),
  '{"pending": 0, "approved": 200, "rejected": 0, "ignored": 0}'::jsonb,
  'review counts are refreshed'
);
select is(
  (select count(*)::int from public.audit_log
   where action = 'comparison.review' and project_id = '00000000-0000-0000-0000-0000000000a1'),
  1,
  'a bulk review writes one audit entry'
);
select is(
  (select jsonb_array_length(details -> 'item_ids') from public.audit_log
   where action = 'comparison.review' and project_id = '00000000-0000-0000-0000-0000000000a1'),
  201,
  'the audit entry lists the selected item ids'
);

select is(
  tests.run_as('00000000-0000-0000-0000-0000000000d2',
    $q$select public.review_items('00000000-0000-0000-0000-0000000000c1', (select ids[1:1] from selection), 'pending', null)::text$q$),
  '1',
  'resetting to pending is allowed'
);
select is(
  (select reviewed_by::text from public.comparison_items
   where id = (select ids[1] from selection)),
  null,
  'pending clears the reviewer'
);

select * from finish();
rollback;
