-- RLS, privileges and RPCs (02 §4, 04 §3, 09 §5, NFR-11). Run with `pnpm test:db`.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- Helpers ---------------------------------------------------------------------------------------

create schema tests;

-- Runs p_sql as p_user (role p_role) and always rolls it back. Returns the number of rows the
-- statement returned (DML needs `returning 1`), or -1 when it was refused with
-- insufficient_privilege (missing grant or RLS violation on insert/update).
create function tests.attempt(p_user uuid, p_sql text, p_role text default 'authenticated')
returns int
language plpgsql
as $$
begin
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', p_user, 'role', p_role)::text, true);
    perform set_config('role', p_role, true);
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

-- Like attempt() but keeps the effects and returns the statement's single value as text.
create function tests.run_as(p_user uuid, p_sql text, p_role text default 'authenticated')
returns text
language plpgsql
as $$
declare
  v text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', p_role)::text, true);
  perform set_config('role', p_role, true);
  execute p_sql into v;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  return v;
exception when others then
  perform set_config('role', 'postgres', true);
  raise;
end;
$$;

-- Fixtures --------------------------------------------------------------------------------------
-- c1 viewer, c2 editor, c3 project admin, c4 platform admin, c5 non-member, c6 user without profile

insert into auth.users (id, email, aud, role, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-0000000000c1', 'Viewer@Test.local', 'authenticated', 'authenticated', '{"full_name":"V"}'),
  ('00000000-0000-0000-0000-0000000000c2', 'editor@test.local', 'authenticated', 'authenticated', '{}'),
  ('00000000-0000-0000-0000-0000000000c3', 'padmin@test.local', 'authenticated', 'authenticated', '{}'),
  ('00000000-0000-0000-0000-0000000000c4', 'platform@test.local', 'authenticated', 'authenticated', '{}'),
  ('00000000-0000-0000-0000-0000000000c5', 'outsider@test.local', 'authenticated', 'authenticated', '{}'),
  ('00000000-0000-0000-0000-0000000000c6', 'noprofile@test.local', 'authenticated', 'authenticated', '{}');
delete from public.profiles where id = '00000000-0000-0000-0000-0000000000c6';
update public.profiles set is_platform_admin = true where id = '00000000-0000-0000-0000-0000000000c4';

insert into public.projects (id, slug, name, sitemap_index, r2_bucket, basic_auth_user, basic_auth_pass_enc)
values ('00000000-0000-0000-0000-0000000000a1', 'test-project', 'Test', 'https://example.test/sitemap.xml',
        'bucket', 'user', 'v1:ciphertext');
insert into public.projects (id, slug, name, sitemap_index, r2_bucket)
values ('00000000-0000-0000-0000-0000000000a2', 'other-project', 'Other', 'https://other.test/sitemap.xml', 'bucket2');

insert into public.project_members (project_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', 'viewer'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c2', 'editor'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c3', 'admin');

insert into public.viewports (id, project_id, slug)
values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 'desktop');
insert into public.sitemap_snapshots (id, project_id, source_url)
values ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a1', 'https://example.test/sitemap.xml');
insert into public.sitemap_urls (id, snapshot_id, url, kind)
values ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000d2', 'https://example.test/', 'page');
insert into public.project_manual_urls (id, project_id, url)
values ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000a1', 'https://example.test/manual');
insert into public.runs (id, project_id, label, status) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', '2026-01-01_00-00-00', 'completed'),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000a1', '2026-01-02_00-00-00', 'completed'),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000a1', '2026-01-03_00-00-00', 'running'),
  ('00000000-0000-0000-0000-0000000000e9', '00000000-0000-0000-0000-0000000000a2', '2026-01-01_00-00-00', 'completed');
insert into public.run_items (id, run_id, url, kind, viewport_slug, filename, status) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e2', 'https://example.test/', 'page', 'desktop', 'index.png', 'done'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000e2', 'https://example.test/a', 'page', 'desktop', 'a.png', 'failed'),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000e2', 'https://example.test/b.pdf', 'file', null, 'b.pdf.txt', 'pending');
insert into public.comparisons (id, project_id, before_run_id, after_run_id, label, share_token_hash, share_expires_at)
values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1',
        '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e2',
        '2026-01-01_00-00-00_vs_2026-01-02_00-00-00',
        encode(sha256(convert_to('good-token', 'UTF8')), 'hex'), now() + interval '1 day');
insert into public.comparisons (id, project_id, before_run_id, after_run_id, label, share_token_hash, share_expires_at)
values ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a1',
        '00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000e1', 'reverse',
        encode(sha256(convert_to('old-token', 'UTF8')), 'hex'), now() - interval '1 day');
insert into public.comparison_items (id, comparison_id, url, name, kind, viewport_slug, status, diff_pct) values
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000b1', 'https://example.test/', 'index', 'page', 'desktop', 'changed', 1.5),
  ('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-0000000000b1', 'https://example.test/a', 'a', 'page', 'desktop', 'unchanged', 0),
  ('00000000-0000-0000-0000-0000000000b5', '00000000-0000-0000-0000-0000000000b1', 'https://example.test/b.pdf', 'b.pdf', 'file', null, 'changed', null);
insert into public.review_memory (id, project_id, url, viewport_slug, after_sha256, review)
values ('00000000-0000-0000-0000-0000000000b6', '00000000-0000-0000-0000-0000000000a1', 'https://example.test/', 'desktop', 'abc', 'approved');
insert into public.ignore_rules (id, project_id, type, url_pattern)
values ('00000000-0000-0000-0000-0000000000b7', '00000000-0000-0000-0000-0000000000a1', 'url_pattern', '**/tmp/**');
insert into public.notification_channels (id, project_id, type, target_enc, events)
values ('00000000-0000-0000-0000-0000000000b8', '00000000-0000-0000-0000-0000000000a1', 'slack', 'v1:webhook', '{run_failed}');
insert into public.notification_log (id, channel_id, event, status)
values ('00000000-0000-0000-0000-0000000000b9', '00000000-0000-0000-0000-0000000000b8', 'run_failed', 'sent');
insert into public.audit_log (id, project_id, action)
values ('00000000-0000-0000-0000-0000000000ba', '00000000-0000-0000-0000-0000000000a1', 'project.update');
insert into public.invitations (id, email, project_id, role)
values ('00000000-0000-0000-0000-0000000000bb', 'new@test.local', '00000000-0000-0000-0000-0000000000a1', 'viewer');

-- NFR-11: every public table has RLS enabled -----------------------------------------------------

select is(
  (select array_agg(c.relname::text order by c.relname)
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity),
  null,
  'every table in schema public has RLS enabled'
);

-- Permission matrix: table x operation x role ----------------------------------------------------
-- expected = {viewer, editor, project admin, platform admin, non-member}; true = allowed.

create temp table matrix (tbl text, op text, sql text, expected boolean[]);
insert into matrix values
  ('profiles', 'select', $$select 1 from public.profiles where id = '00000000-0000-0000-0000-0000000000c2'$$, '{t,t,t,t,f}'),
  ('profiles', 'insert', $$insert into public.profiles (id, email) values ('00000000-0000-0000-0000-0000000000c6', 'noprofile@test.local') returning 1$$, '{f,f,f,t,f}'),
  ('profiles', 'update', $$update public.profiles set full_name = 'x' where id = '00000000-0000-0000-0000-0000000000c2' returning 1$$, '{f,t,f,t,f}'),
  ('profiles', 'delete', $$delete from public.profiles where id = '00000000-0000-0000-0000-0000000000c2' returning 1$$, '{f,f,f,f,f}'),

  ('projects', 'select', $$select 1 from public.projects where id = '00000000-0000-0000-0000-0000000000a1'$$, '{t,t,t,t,f}'),
  ('projects', 'insert', $$insert into public.projects (slug, name, sitemap_index, r2_bucket) values ('new-p', 'N', 'https://n.test/s.xml', 'b') returning 1$$, '{f,f,f,t,f}'),
  ('projects', 'update', $$update public.projects set name = 'x' where id = '00000000-0000-0000-0000-0000000000a1' returning 1$$, '{f,f,t,t,f}'),
  ('projects', 'delete', $$delete from public.projects where id = '00000000-0000-0000-0000-0000000000a1' returning 1$$, '{f,f,f,t,f}'),

  ('invitations', 'select', $$select 1 from public.invitations where id = '00000000-0000-0000-0000-0000000000bb'$$, '{f,f,t,t,f}'),
  ('invitations', 'insert', $$insert into public.invitations (email, project_id, role) values ('x@test.local', '00000000-0000-0000-0000-0000000000a1', 'editor') returning 1$$, '{f,f,t,t,f}'),
  ('invitations', 'update', $$update public.invitations set role = 'editor' where id = '00000000-0000-0000-0000-0000000000bb' returning 1$$, '{f,f,t,t,f}'),
  ('invitations', 'delete', $$delete from public.invitations where id = '00000000-0000-0000-0000-0000000000bb' returning 1$$, '{f,f,t,t,f}'),

  ('viewports', 'select', $$select 1 from public.viewports where id = '00000000-0000-0000-0000-0000000000d1'$$, '{t,t,t,t,f}'),
  ('viewports', 'insert', $$insert into public.viewports (project_id, slug) values ('00000000-0000-0000-0000-0000000000a1', 'mobile') returning 1$$, '{f,f,t,t,f}'),
  ('viewports', 'update', $$update public.viewports set width = 1440 where id = '00000000-0000-0000-0000-0000000000d1' returning 1$$, '{f,f,t,t,f}'),
  ('viewports', 'delete', $$delete from public.viewports where id = '00000000-0000-0000-0000-0000000000d1' returning 1$$, '{f,f,t,t,f}'),

  ('project_members', 'select', $$select 1 from public.project_members where user_id = '00000000-0000-0000-0000-0000000000c1'$$, '{t,t,t,t,f}'),
  ('project_members', 'insert', $$insert into public.project_members (project_id, user_id, role) values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c5', 'viewer') returning 1$$, '{f,f,t,t,f}'),
  ('project_members', 'update', $$update public.project_members set role = 'editor' where user_id = '00000000-0000-0000-0000-0000000000c1' returning 1$$, '{f,f,t,t,f}'),
  ('project_members', 'delete', $$delete from public.project_members where user_id = '00000000-0000-0000-0000-0000000000c1' returning 1$$, '{f,f,t,t,f}'),

  ('sitemap_snapshots', 'select', $$select 1 from public.sitemap_snapshots where id = '00000000-0000-0000-0000-0000000000d2'$$, '{t,t,t,t,f}'),
  ('sitemap_snapshots', 'insert', $$insert into public.sitemap_snapshots (project_id, source_url) values ('00000000-0000-0000-0000-0000000000a1', 'https://example.test/s.xml') returning 1$$, '{f,t,t,t,f}'),
  ('sitemap_snapshots', 'update', $$update public.sitemap_snapshots set status = 'completed' where id = '00000000-0000-0000-0000-0000000000d2' returning 1$$, '{f,t,t,t,f}'),
  ('sitemap_snapshots', 'delete', $$delete from public.sitemap_snapshots where id = '00000000-0000-0000-0000-0000000000d2' returning 1$$, '{f,f,t,t,f}'),

  ('sitemap_urls', 'select', $$select 1 from public.sitemap_urls where id = '00000000-0000-0000-0000-0000000000d3'$$, '{t,t,t,t,f}'),
  ('sitemap_urls', 'insert', $$insert into public.sitemap_urls (snapshot_id, url, kind) values ('00000000-0000-0000-0000-0000000000d2', 'https://example.test/new', 'page') returning 1$$, '{f,t,t,t,f}'),
  ('sitemap_urls', 'update', $$update public.sitemap_urls set included = false where id = '00000000-0000-0000-0000-0000000000d3' returning 1$$, '{f,t,t,t,f}'),
  ('sitemap_urls', 'delete', $$delete from public.sitemap_urls where id = '00000000-0000-0000-0000-0000000000d3' returning 1$$, '{f,f,t,t,f}'),

  ('project_manual_urls', 'select', $$select 1 from public.project_manual_urls where id = '00000000-0000-0000-0000-0000000000d4'$$, '{t,t,t,t,f}'),
  ('project_manual_urls', 'insert', $$insert into public.project_manual_urls (project_id, url) values ('00000000-0000-0000-0000-0000000000a1', 'https://example.test/m2') returning 1$$, '{f,t,t,t,f}'),
  ('project_manual_urls', 'update', $$update public.project_manual_urls set note = 'x' where id = '00000000-0000-0000-0000-0000000000d4' returning 1$$, '{f,t,t,t,f}'),
  ('project_manual_urls', 'delete', $$delete from public.project_manual_urls where id = '00000000-0000-0000-0000-0000000000d4' returning 1$$, '{f,t,t,t,f}'),

  ('runs', 'select', $$select 1 from public.runs where id = '00000000-0000-0000-0000-0000000000e1'$$, '{t,t,t,t,f}'),
  ('runs', 'insert', $$insert into public.runs (project_id, label) values ('00000000-0000-0000-0000-0000000000a1', '2026-02-01_00-00-00') returning 1$$, '{f,t,t,t,f}'),
  ('runs', 'update', $$update public.runs set note = 'x' where id = '00000000-0000-0000-0000-0000000000e1' returning 1$$, '{f,t,t,t,f}'),
  ('runs', 'delete', $$delete from public.runs where id = '00000000-0000-0000-0000-0000000000e3' returning 1$$, '{f,f,t,t,f}'),

  ('run_items', 'select', $$select 1 from public.run_items where id = '00000000-0000-0000-0000-0000000000f1'$$, '{t,t,t,t,f}'),
  ('run_items', 'insert', $$insert into public.run_items (run_id, url, kind, viewport_slug, filename) values ('00000000-0000-0000-0000-0000000000e2', 'https://example.test/n', 'page', 'desktop', 'n.png') returning 1$$, '{f,t,t,t,f}'),
  ('run_items', 'update', $$update public.run_items set attempts = 2 where id = '00000000-0000-0000-0000-0000000000f1' returning 1$$, '{f,t,t,t,f}'),
  ('run_items', 'delete', $$delete from public.run_items where id = '00000000-0000-0000-0000-0000000000f1' returning 1$$, '{f,f,t,t,f}'),

  ('comparisons', 'select', $$select 1 from public.comparisons where id = '00000000-0000-0000-0000-0000000000b1'$$, '{t,t,t,t,f}'),
  ('comparisons', 'insert', $$insert into public.comparisons (project_id, before_run_id, after_run_id, label) values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e3', 'x') returning 1$$, '{f,t,t,t,f}'),
  ('comparisons', 'update', $$update public.comparisons set status = 'running' where id = '00000000-0000-0000-0000-0000000000b1' returning 1$$, '{f,t,t,t,f}'),
  ('comparisons', 'delete', $$delete from public.comparisons where id = '00000000-0000-0000-0000-0000000000b1' returning 1$$, '{f,f,t,t,f}'),

  ('comparison_items', 'select', $$select 1 from public.comparison_items where id = '00000000-0000-0000-0000-0000000000b3'$$, '{t,t,t,t,f}'),
  ('comparison_items', 'insert', $$insert into public.comparison_items (comparison_id, name, kind, status) values ('00000000-0000-0000-0000-0000000000b1', 'n', 'page', 'new') returning 1$$, '{f,t,t,t,f}'),
  ('comparison_items', 'update', $$update public.comparison_items set status = 'unchanged' where id = '00000000-0000-0000-0000-0000000000b3' returning 1$$, '{f,t,t,t,f}'),
  ('comparison_items', 'delete', $$delete from public.comparison_items where id = '00000000-0000-0000-0000-0000000000b3' returning 1$$, '{f,f,t,t,f}'),

  ('review_memory', 'select', $$select 1 from public.review_memory where id = '00000000-0000-0000-0000-0000000000b6'$$, '{t,t,t,t,f}'),
  ('review_memory', 'insert', $$insert into public.review_memory (project_id, url, after_sha256, review) values ('00000000-0000-0000-0000-0000000000a1', 'https://example.test/x', 'def', 'approved') returning 1$$, '{f,f,f,f,f}'),
  ('review_memory', 'update', $$update public.review_memory set review = 'rejected' where id = '00000000-0000-0000-0000-0000000000b6' returning 1$$, '{f,f,f,f,f}'),
  ('review_memory', 'delete', $$delete from public.review_memory where id = '00000000-0000-0000-0000-0000000000b6' returning 1$$, '{f,f,f,f,f}'),

  ('ignore_rules', 'select', $$select 1 from public.ignore_rules where id = '00000000-0000-0000-0000-0000000000b7'$$, '{t,t,t,t,f}'),
  ('ignore_rules', 'insert', $$insert into public.ignore_rules (project_id, type, selector) values ('00000000-0000-0000-0000-0000000000a1', 'selector', '.ad') returning 1$$, '{f,t,t,t,f}'),
  ('ignore_rules', 'update', $$update public.ignore_rules set enabled = false where id = '00000000-0000-0000-0000-0000000000b7' returning 1$$, '{f,t,t,t,f}'),
  ('ignore_rules', 'delete', $$delete from public.ignore_rules where id = '00000000-0000-0000-0000-0000000000b7' returning 1$$, '{f,t,t,t,f}'),

  ('notification_channels', 'select', $$select 1 from public.notification_channels where id = '00000000-0000-0000-0000-0000000000b8'$$, '{t,t,t,t,f}'),
  ('notification_channels', 'insert', $$insert into public.notification_channels (project_id, type, target) values ('00000000-0000-0000-0000-0000000000a1', 'email', 'ops@test.local') returning 1$$, '{f,f,t,t,f}'),
  ('notification_channels', 'update', $$update public.notification_channels set enabled = false where id = '00000000-0000-0000-0000-0000000000b8' returning 1$$, '{f,f,t,t,f}'),
  ('notification_channels', 'delete', $$delete from public.notification_channels where id = '00000000-0000-0000-0000-0000000000b8' returning 1$$, '{f,f,t,t,f}'),

  ('notification_log', 'select', $$select 1 from public.notification_log where id = '00000000-0000-0000-0000-0000000000b9'$$, '{f,f,t,t,f}'),
  ('notification_log', 'insert', $$insert into public.notification_log (channel_id, event, status) values ('00000000-0000-0000-0000-0000000000b8', 'run_failed', 'sent') returning 1$$, '{f,f,f,f,f}'),
  ('notification_log', 'update', $$update public.notification_log set status = 'failed' where id = '00000000-0000-0000-0000-0000000000b9' returning 1$$, '{f,f,f,f,f}'),
  ('notification_log', 'delete', $$delete from public.notification_log where id = '00000000-0000-0000-0000-0000000000b9' returning 1$$, '{f,f,f,f,f}'),

  ('audit_log', 'select', $$select 1 from public.audit_log where id = '00000000-0000-0000-0000-0000000000ba'$$, '{f,f,t,t,f}'),
  ('audit_log', 'insert', $$insert into public.audit_log (project_id, action) values ('00000000-0000-0000-0000-0000000000a1', 'x') returning 1$$, '{f,f,f,f,f}'),
  ('audit_log', 'update', $$update public.audit_log set action = 'x' where id = '00000000-0000-0000-0000-0000000000ba' returning 1$$, '{f,f,f,f,f}'),
  ('audit_log', 'delete', $$delete from public.audit_log where id = '00000000-0000-0000-0000-0000000000ba' returning 1$$, '{f,f,f,f,f}');

create temp table roles (idx int, name text, user_id uuid);
insert into roles values
  (1, 'viewer',         '00000000-0000-0000-0000-0000000000c1'),
  (2, 'editor',         '00000000-0000-0000-0000-0000000000c2'),
  (3, 'project admin',  '00000000-0000-0000-0000-0000000000c3'),
  (4, 'platform admin', '00000000-0000-0000-0000-0000000000c4'),
  (5, 'non-member',     '00000000-0000-0000-0000-0000000000c5');

select is(
  tests.attempt(r.user_id, m.sql) > 0,
  m.expected[r.idx],
  format('%s %s %s %s', r.name, case when m.expected[r.idx] then 'can' else 'cannot' end, m.op, m.tbl)
)
from matrix m cross join roles r
order by m.tbl, m.op, r.idx;

-- every public table is covered by the matrix
select is(
  (select array_agg(c.relname::text order by c.relname)
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and c.relname not in (select tbl from matrix)),
  null,
  'permission matrix covers every public table'
);

-- Non-members see nothing of the project ---------------------------------------------------------

select is(
  tests.attempt('00000000-0000-0000-0000-0000000000c5', $$
    select 1 from public.projects_public
    union all select 1 from public.projects
    union all select 1 from public.viewports
    union all select 1 from public.project_members
    union all select 1 from public.runs
    union all select 1 from public.run_items
    union all select 1 from public.comparisons
    union all select 1 from public.comparison_items
    union all select 1 from public.sitemap_snapshots
    union all select 1 from public.sitemap_urls
    union all select 1 from public.ignore_rules
    union all select 1 from public.notification_channels
    union all select 1 from public.review_memory
    union all select 1 from public.audit_log
    union all select 1 from public.invitations$$),
  0,
  'non-member sees no project or child rows'
);
select is(
  tests.attempt('00000000-0000-0000-0000-0000000000c3',
    $$select 1 from public.projects where id = '00000000-0000-0000-0000-0000000000a2'$$),
  0,
  'project admin cannot see a project they are not a member of'
);
select is(
  tests.attempt('00000000-0000-0000-0000-0000000000c4', $$select 1 from public.projects
    where id in ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2')$$),
  2,
  'platform admin sees every project'
);
select is(
  tests.attempt(null, $$select 1 from public.projects_public$$, 'anon'),
  -1,
  'anon cannot read projects_public'
);

-- Encrypted columns ------------------------------------------------------------------------------

select is(
  tests.attempt(r.user_id, $$select basic_auth_pass_enc from public.projects$$),
  -1,
  format('%s cannot select projects.basic_auth_pass_enc', r.name)
)
from roles r order by r.idx;
select is(
  tests.attempt(r.user_id, $$select target_enc from public.notification_channels$$),
  -1,
  format('%s cannot select notification_channels.target_enc', r.name)
)
from roles r order by r.idx;
select hasnt_column('public', 'projects_public', 'basic_auth_pass_enc', 'projects_public has no encrypted column');
select is(
  tests.run_as('00000000-0000-0000-0000-0000000000c1',
    $$select has_basic_auth::text from public.projects_public where id = '00000000-0000-0000-0000-0000000000a1'$$),
  'true',
  'viewer sees has_basic_auth through projects_public'
);

-- Profiles ---------------------------------------------------------------------------------------

select is(
  (select email || '|' || full_name from public.profiles where id = '00000000-0000-0000-0000-0000000000c1'),
  'viewer@test.local|V',
  'sign-up trigger creates a profile with lower-cased email and full_name'
);
select is(
  tests.attempt('00000000-0000-0000-0000-0000000000c2',
    $$update public.profiles set is_platform_admin = true where id = '00000000-0000-0000-0000-0000000000c2' returning 1$$),
  -1,
  'user cannot promote themselves to platform admin'
);
select is(
  tests.attempt('00000000-0000-0000-0000-0000000000c4',
    $$update public.profiles set disabled_at = now() where id = '00000000-0000-0000-0000-0000000000c2' returning 1$$),
  1,
  'platform admin can disable a user'
);
select is(
  tests.attempt('00000000-0000-0000-0000-0000000000c5',
    $$select 1 from public.profiles where id = '00000000-0000-0000-0000-0000000000c5'$$),
  1,
  'non-member sees their own profile'
);

-- Review columns only via review_items() ---------------------------------------------------------

select is(
  tests.attempt('00000000-0000-0000-0000-0000000000c2',
    $$update public.comparison_items set review = 'approved' where id = '00000000-0000-0000-0000-0000000000b3' returning 1$$),
  -1,
  'editor cannot write review columns directly'
);
select throws_ok(
  $$select tests.run_as('00000000-0000-0000-0000-0000000000c1',
    $q$select public.review_items('00000000-0000-0000-0000-0000000000b1', array['00000000-0000-0000-0000-0000000000b3']::uuid[], 'approved', null)::text$q$)$$,
  '42501', null,
  'viewer cannot call review_items'
);
select is(
  tests.run_as('00000000-0000-0000-0000-0000000000c2',
    $$select public.review_items('00000000-0000-0000-0000-0000000000b1', array['00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000b4']::uuid[], 'approved', 'ok')::text$$),
  '2',
  'editor reviews items through review_items'
);
select is(
  (select review::text || '|' || reviewed_by::text || '|' || review_note
   from public.comparison_items where id = '00000000-0000-0000-0000-0000000000b3'),
  'approved|00000000-0000-0000-0000-0000000000c2|ok',
  'review_items stores review, reviewer and note'
);
select is(
  (select review_counts from public.comparisons where id = '00000000-0000-0000-0000-0000000000b1'),
  '{"pending":1,"approved":1,"rejected":0,"ignored":0}'::jsonb,
  'review_items refreshes review_counts (changed items only)'
);
select is(
  (select counts from public.comparisons where id = '00000000-0000-0000-0000-0000000000b1'),
  '{"compared":2,"changed":1,"unchanged":1,"new":0,"missing":0,"redirect":0,"error":0,"files_changed":1,"files_total":1,
    "viewports":{"desktop":{"compared":2,"changed":1,"unchanged":1,"new":0,"missing":0,"redirect":0,"error":0}}}'::jsonb,
  'comparison counts are recomputed'
);
select ok(
  exists (select 1 from public.audit_log
          where action = 'comparison.review' and actor_id = '00000000-0000-0000-0000-0000000000c2'
            and project_id = '00000000-0000-0000-0000-0000000000a1'),
  'review_items writes an audit entry'
);

-- set_baseline -----------------------------------------------------------------------------------

select throws_ok(
  $$select tests.run_as('00000000-0000-0000-0000-0000000000c1',
    $q$select public.set_baseline('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e2')::text$q$)$$,
  '42501', null,
  'viewer cannot set the baseline'
);
select throws_ok(
  $$select tests.run_as('00000000-0000-0000-0000-0000000000c2',
    $q$select public.set_baseline('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e3')::text$q$)$$,
  '23514', null,
  'a running run cannot be the baseline'
);
select throws_ok(
  $$select tests.run_as('00000000-0000-0000-0000-0000000000c2',
    $q$select public.set_baseline('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e9')::text$q$)$$,
  'P0002', null,
  'a run of another project cannot be the baseline'
);
select lives_ok(
  $$select tests.run_as('00000000-0000-0000-0000-0000000000c2',
    $q$select public.set_baseline('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e2')::text$q$)$$,
  'editor sets the baseline'
);
select is(
  (select baseline_run_id from public.projects where id = '00000000-0000-0000-0000-0000000000a1'),
  '00000000-0000-0000-0000-0000000000e2'::uuid,
  'baseline_run_id is updated'
);
select ok(
  exists (select 1 from public.audit_log where action = 'project.set_baseline'),
  'set_baseline writes an audit entry'
);

-- Counters (service role only) ---------------------------------------------------------------------

select throws_ok(
  $$select tests.run_as('00000000-0000-0000-0000-0000000000c4',
    $q$select public.refresh_run_counts('00000000-0000-0000-0000-0000000000e2')::text$q$)$$,
  '42501', null,
  'authenticated users cannot call refresh_run_counts'
);
select lives_ok(
  $$select tests.run_as(null,
    $q$select public.refresh_run_counts('00000000-0000-0000-0000-0000000000e2')::text$q$, 'service_role')$$,
  'service role calls refresh_run_counts'
);
select is(
  (select array[total_items, done_items, failed_items] from public.runs where id = '00000000-0000-0000-0000-0000000000e2'),
  array[3, 1, 1],
  'refresh_run_counts recomputes total/done/failed'
);
select throws_ok(
  $$select tests.run_as('00000000-0000-0000-0000-0000000000c4',
    $q$select public.refresh_comparison_counts('00000000-0000-0000-0000-0000000000b1')::text$q$)$$,
  '42501', null,
  'authenticated users cannot call refresh_comparison_counts'
);

-- Share tokens -----------------------------------------------------------------------------------

select is(
  tests.run_as(null, $$select public.resolve_share_token('good-token')::text$$, 'anon'),
  '00000000-0000-0000-0000-0000000000b1',
  'anon resolves a valid share token'
);
select is(
  tests.run_as(null, $$select public.resolve_share_token('old-token')::text$$, 'anon'),
  null,
  'expired share token resolves to null'
);
select is(
  tests.run_as(null, $$select public.resolve_share_token('wrong')::text$$, 'anon'),
  null,
  'unknown share token resolves to null'
);

-- Constraints ------------------------------------------------------------------------------------

select throws_ok(
  $$insert into public.comparisons (project_id, before_run_id, after_run_id, label)
    values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e9', 'x')$$,
  '23503', null,
  'comparison runs must belong to the comparison project'
);
select throws_ok(
  $$insert into public.run_items (run_id, url, kind, viewport_slug, filename)
    values ('00000000-0000-0000-0000-0000000000e2', 'https://example.test/b.pdf', 'file', null, 'b.pdf.txt')$$,
  '23505', null,
  'run_items are unique per (run, url, viewport) including null viewport'
);

-- Disabled users lose access ----------------------------------------------------------------------

update public.profiles set disabled_at = now() where id = '00000000-0000-0000-0000-0000000000c3';
select is(
  tests.attempt('00000000-0000-0000-0000-0000000000c3', $$select 1 from public.projects$$),
  0,
  'disabled user sees no projects'
);

select * from finish();
rollback;
