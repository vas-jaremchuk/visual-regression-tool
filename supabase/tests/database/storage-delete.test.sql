-- Storage cache, run sizes and the baseline delete guard (T22). Run with `pnpm test:db`.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create schema tests;

create function tests.as_user(p_user uuid, p_sql text)
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

-- d1 viewer, d2 editor, d3 project admin, d4 platform admin
insert into auth.users (id, email, aud, role)
values
  ('00000000-0000-0000-0000-0000000000d1', 'sviewer@test.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000d2', 'seditor@test.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000d3', 'sadmin@test.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000d4', 'splatform@test.local', 'authenticated', 'authenticated');
update public.profiles set is_platform_admin = true where id = '00000000-0000-0000-0000-0000000000d4';

insert into public.projects (id, slug, name, sitemap_index, r2_bucket)
values
  ('00000000-0000-0000-0000-0000000000a1', 'storage', 'Storage', 'https://e.test/sitemap.xml', 'bucket'),
  ('00000000-0000-0000-0000-0000000000a2', 'other', 'Other', 'https://o.test/sitemap.xml', 'bucket2');
insert into public.project_members (project_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', 'viewer'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d2', 'editor'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d3', 'admin');

insert into public.storage_usage (project_id, bucket, status, total_bytes, object_count)
values
  ('00000000-0000-0000-0000-0000000000a1', 'bucket', 'completed', 100, 3),
  ('00000000-0000-0000-0000-0000000000a2', 'bucket2', 'completed', 50, 1);

-- storage_usage RLS ------------------------------------------------------------------------------

select is(
  tests.as_user('00000000-0000-0000-0000-0000000000d2', 'select count(*)::text from public.storage_usage'),
  '0', 'editors do not see storage usage');
select is(
  tests.as_user('00000000-0000-0000-0000-0000000000d1', 'select count(*)::text from public.storage_usage'),
  '0', 'viewers do not see storage usage');
select is(
  tests.as_user('00000000-0000-0000-0000-0000000000d3', 'select string_agg(bucket, '','') from public.storage_usage'),
  'bucket', 'project admins see their project only');
select is(
  tests.as_user('00000000-0000-0000-0000-0000000000d4', 'select count(*)::text from public.storage_usage'),
  '2', 'platform admins see every project');
select throws_ok(
  $$ select tests.as_user('00000000-0000-0000-0000-0000000000d3',
       'update public.storage_usage set total_bytes = 0 returning 1') $$,
  '42501', null, 'project admins cannot write the cache');
select throws_ok(
  $$ select tests.as_user('00000000-0000-0000-0000-0000000000d4',
       'insert into public.storage_usage (project_id, bucket) values (''00000000-0000-0000-0000-0000000000a2'', ''x'') returning 1') $$,
  '42501', null, 'platform admins cannot write the cache either; only the worker does');

-- run_sizes ---------------------------------------------------------------------------------------

insert into public.runs (id, project_id, label, status, viewport_slugs)
values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', '2026-11-01_10-00-00', 'completed', '{desktop}'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a1', '2026-11-02_10-00-00', 'completed', '{desktop}'),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000a2', '2026-11-03_10-00-00', 'completed', '{desktop}');
insert into public.run_items (run_id, url, kind, viewport_slug, filename, status, bytes)
values
  ('00000000-0000-0000-0000-0000000000b1', 'https://e.test/', 'page', 'desktop', 'home.png', 'done', 30),
  ('00000000-0000-0000-0000-0000000000b1', 'https://e.test/a/', 'page', 'desktop', 'a.png', 'done', 12),
  ('00000000-0000-0000-0000-0000000000b1', 'https://e.test/b/', 'page', 'desktop', 'b.png', 'failed', null),
  ('00000000-0000-0000-0000-0000000000b3', 'https://o.test/', 'page', 'desktop', 'home.png', 'done', 99);

select is(
  tests.as_user('00000000-0000-0000-0000-0000000000d1',
    'select bytes || ''/'' || objects from public.run_sizes where run_id = ''00000000-0000-0000-0000-0000000000b1'''),
  '42/2', 'run_sizes sums item bytes and counts stored objects');
select is(
  tests.as_user('00000000-0000-0000-0000-0000000000d1', 'select count(*)::text from public.run_sizes'),
  '1', 'run_sizes follows run_items RLS');

-- Baseline guard ----------------------------------------------------------------------------------

update public.projects set baseline_run_id = '00000000-0000-0000-0000-0000000000b1'
where id = '00000000-0000-0000-0000-0000000000a1';

select throws_ok(
  $$ delete from public.runs where id = '00000000-0000-0000-0000-0000000000b1' $$,
  '23514', null, 'the baseline run cannot be deleted');
select lives_ok(
  $$ delete from public.runs where id = '00000000-0000-0000-0000-0000000000b2' $$,
  'other runs can be deleted');

update public.projects set baseline_run_id = null where id = '00000000-0000-0000-0000-0000000000a1';
select lives_ok(
  $$ delete from public.runs where id = '00000000-0000-0000-0000-0000000000b1' $$,
  'the former baseline can be deleted once the baseline changed');

update public.projects set baseline_run_id = '00000000-0000-0000-0000-0000000000b3'
where id = '00000000-0000-0000-0000-0000000000a2';
select lives_ok(
  $$ delete from public.projects where id = '00000000-0000-0000-0000-0000000000a2' $$,
  'deleting the project cascades to its baseline run');
select is((select count(*)::int from public.runs where id = '00000000-0000-0000-0000-0000000000b3'), 0,
  'the baseline run went with its project');
select is((select count(*)::int from public.storage_usage where project_id = '00000000-0000-0000-0000-0000000000a2'), 0,
  'the storage cache went with its project');

select * from finish();
rollback;
