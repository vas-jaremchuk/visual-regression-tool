-- Sitemap snapshots (F-SITEMAP-1..4, T10). Run with `pnpm test:db`.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

create schema tests;

-- Runs p_sql as p_user and returns the number of affected rows; -1 when refused.
create function tests.attempt(p_user uuid, p_sql text)
returns int
language plpgsql
as $$
begin
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    declare
      n int;
    begin
      execute format('with t as (%s) select count(*) from t', p_sql) into n;
      raise exception using errcode = 'VRT01', message = n::text;
    end;
  exception
    when sqlstate 'VRT01' then return sqlerrm::int;
    when insufficient_privilege then return -1;
  end;
end;
$$;

-- c1 viewer, c2 editor, c3 project admin
insert into auth.users (id, email, aud, role)
values
  ('00000000-0000-0000-0000-0000000000c1', 'viewer@test.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000c2', 'editor@test.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000c3', 'padmin@test.local', 'authenticated', 'authenticated');

insert into public.projects (id, slug, name, sitemap_index, r2_bucket, notes)
values ('00000000-0000-0000-0000-0000000000a1', 'fresh', 'Fresh', 'https://example.test/sitemap.xml', 'bucket', 'hello'),
       ('00000000-0000-0000-0000-0000000000a2', 'used', 'Used', 'https://example.test/sitemap.xml', 'bucket2', null);
insert into public.project_members (project_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', 'viewer'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c2', 'editor'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c3', 'admin');

-- progress columns and realtime ------------------------------------------------------------------

select has_column('public', 'sitemap_snapshots', 'urls_checked', 'snapshots record URLs checked');
select has_column('public', 'sitemap_snapshots', 'urls_total', 'snapshots record URLs to check');
select has_column('public', 'sitemap_snapshots', 'finished_at', 'snapshots record when they finished');
select ok(
  exists (select 1 from pg_publication_tables
          where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sitemap_snapshots'),
  'sitemap_snapshots is published to Realtime'
);
select ok(
  not exists (select 1 from pg_publication_tables
              where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sitemap_urls'),
  'sitemap_urls is not published (too chatty)'
);

-- start a snapshot (editor+) -----------------------------------------------------------------------

select is(
  tests.attempt('00000000-0000-0000-0000-0000000000c1',
    $$insert into public.sitemap_snapshots (project_id, source_url, started_by)
      values ('00000000-0000-0000-0000-0000000000a1', 'https://example.test/sitemap.xml', auth.uid()) returning 1$$),
  -1, 'viewers cannot start a snapshot'
);
select is(
  tests.attempt('00000000-0000-0000-0000-0000000000c2',
    $$insert into public.sitemap_snapshots (project_id, source_url, started_by)
      values ('00000000-0000-0000-0000-0000000000a1', 'https://example.test/sitemap.xml', auth.uid()) returning 1$$),
  1, 'editors start a snapshot'
);
select is(
  tests.attempt('00000000-0000-0000-0000-0000000000c2',
    $$insert into public.sitemap_snapshots (project_id, source_url)
      values ('00000000-0000-0000-0000-0000000000a2', 'https://example.test/sitemap.xml') returning 1$$),
  -1, 'non-members cannot start a snapshot'
);

-- manual URLs (editor+) ----------------------------------------------------------------------------

select is(
  tests.attempt('00000000-0000-0000-0000-0000000000c1',
    $$insert into public.project_manual_urls (project_id, url)
      values ('00000000-0000-0000-0000-0000000000a1', 'https://example.test/x') returning 1$$),
  -1, 'viewers cannot add manual URLs'
);
select is(
  tests.attempt('00000000-0000-0000-0000-0000000000c2',
    $$insert into public.project_manual_urls (project_id, url)
      values ('00000000-0000-0000-0000-0000000000a1', 'https://example.test/x') returning 1$$),
  1, 'editors add manual URLs'
);

-- the worker (service role) writes progress and URLs --------------------------------------------------

insert into public.sitemap_snapshots (id, project_id, source_url)
values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', 'https://example.test/sitemap.xml');
update public.sitemap_snapshots set urls_checked = 3, urls_total = 5 where id = '00000000-0000-0000-0000-0000000000e1';
insert into public.sitemap_urls (snapshot_id, url, kind, http_status, redirect_to, included)
values ('00000000-0000-0000-0000-0000000000e1', 'https://example.test/old', 'page', 301, 'https://example.test/new', false);
select is(
  tests.attempt('00000000-0000-0000-0000-0000000000c1',
    $$select 1 from public.sitemap_snapshots where id = '00000000-0000-0000-0000-0000000000e1' and urls_checked = 3$$),
  1, 'viewers read snapshot progress'
);
select is(
  tests.attempt('00000000-0000-0000-0000-0000000000c1',
    $$select 1 from public.sitemap_urls where snapshot_id = '00000000-0000-0000-0000-0000000000e1'$$),
  1, 'viewers read snapshot URLs'
);
select throws_ok(
  $$update public.sitemap_snapshots set urls_checked = -1 where id = '00000000-0000-0000-0000-0000000000e1'$$,
  '23514', null, 'progress cannot be negative'
);

select * from finish();
rollback;
