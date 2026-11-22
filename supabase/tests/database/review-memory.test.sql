-- Review memory (T20, F-REVIEW-6): review_items remembers decisions. Run with `pnpm test:db`.
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

-- d2 editor
insert into auth.users (id, email, aud, role)
values ('00000000-0000-0000-0000-0000000000d2', 'editor@test.local', 'authenticated', 'authenticated');

insert into public.projects (id, slug, name, sitemap_index, r2_bucket)
values ('00000000-0000-0000-0000-0000000000a1', 'memory', 'Memory', 'https://example.test/sitemap.xml', 'bucket');
insert into public.project_members (project_id, user_id, role)
values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d2', 'editor');

insert into public.runs (id, project_id, label, status) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'base', 'completed'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a1', 'after', 'completed');
insert into public.run_items (run_id, url, kind, viewport_slug, filename, status, sha256) values
  ('00000000-0000-0000-0000-0000000000b2', 'https://example.test/a', 'page', 'desktop', 'a.png', 'done', 'sha-a'),
  ('00000000-0000-0000-0000-0000000000b2', 'https://example.test/b', 'page', 'desktop', 'b.png', 'done', 'sha-b'),
  ('00000000-0000-0000-0000-0000000000b2', 'https://example.test/c', 'page', 'desktop', 'c.png', 'done', null);
insert into public.comparisons (id, project_id, before_run_id, after_run_id, label, status)
values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1',
        '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2',
        'base_vs_after', 'completed');
insert into public.comparison_items (id, comparison_id, url, name, kind, viewport_slug, status) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000c1', 'https://example.test/a', 'a', 'page', 'desktop', 'changed'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000c1', 'https://example.test/b', 'b', 'page', 'desktop', 'unchanged'),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000c1', 'https://example.test/c', 'c', 'page', 'desktop', 'changed');

select tests.run_as('00000000-0000-0000-0000-0000000000d2',
  $q$select public.review_items('00000000-0000-0000-0000-0000000000c1',
    array['00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e2',
          '00000000-0000-0000-0000-0000000000e3']::uuid[], 'approved', null)::text$q$);

select results_eq(
  $$select url, viewport_slug, after_sha256, review::text, decided_by::text, comparison_id::text, comparison_label
    from public.review_memory order by url$$,
  $$values ('https://example.test/a', 'desktop', 'sha-a', 'approved',
            '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000c1', 'base_vs_after')$$,
  'approving a changed page remembers url, viewport, after sha256, decision and comparison'
);

select tests.run_as('00000000-0000-0000-0000-0000000000d2',
  $q$select public.review_items('00000000-0000-0000-0000-0000000000c1',
    array['00000000-0000-0000-0000-0000000000e1']::uuid[], 'rejected', null)::text$q$);
select results_eq(
  $$select review::text from public.review_memory$$,
  $$values ('rejected')$$,
  'a later decision on the same after PNG replaces the remembered one'
);

select tests.run_as('00000000-0000-0000-0000-0000000000d2',
  $q$select public.review_items('00000000-0000-0000-0000-0000000000c1',
    array['00000000-0000-0000-0000-0000000000e1']::uuid[], 'ignored', null)::text$q$);
select results_eq(
  $$select review::text from public.review_memory$$,
  $$values ('ignored')$$,
  'ignoring is remembered'
);

select tests.run_as('00000000-0000-0000-0000-0000000000d2',
  $q$select public.review_items('00000000-0000-0000-0000-0000000000c1',
    array['00000000-0000-0000-0000-0000000000e1']::uuid[], 'pending', null)::text$q$);
select is(
  (select count(*)::int from public.review_memory),
  0,
  'resetting to pending forgets what this comparison remembered'
);

select tests.run_as('00000000-0000-0000-0000-0000000000d2',
  $q$select public.review_items('00000000-0000-0000-0000-0000000000c1',
    array['00000000-0000-0000-0000-0000000000e1']::uuid[], 'approved', null)::text$q$);
delete from public.comparisons where id = '00000000-0000-0000-0000-0000000000c1';
select results_eq(
  $$select comparison_id::text, comparison_label from public.review_memory$$,
  $$values (null::text, 'base_vs_after')$$,
  'the memory outlives its comparison and keeps the label'
);

select * from finish();
rollback;
