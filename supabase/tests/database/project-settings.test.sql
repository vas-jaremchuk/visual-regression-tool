-- Project settings migration (03 §6, F-VIEWPORT-1). Run with `pnpm test:db`.
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
insert into public.viewports (id, project_id, slug) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', 'desktop'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a2', 'desktop'),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000a2', 'mobile');
insert into public.runs (project_id, label, status, viewport_slugs)
values ('00000000-0000-0000-0000-0000000000a2', '2026-01-01_00-00-00', 'completed', '{desktop}');

-- notes --------------------------------------------------------------------------------------------

select is(
  tests.attempt('00000000-0000-0000-0000-0000000000c1',
    $$select 1 from public.projects_public where notes = 'hello'$$),
  1, 'viewers read notes through projects_public'
);
select is(
  tests.attempt('00000000-0000-0000-0000-0000000000c2',
    $$update public.projects set notes = 'x' where id = '00000000-0000-0000-0000-0000000000a1' returning 1$$),
  0, 'editors cannot change notes'
);
select is(
  tests.attempt('00000000-0000-0000-0000-0000000000c3',
    $$update public.projects set notes = 'x' where id = '00000000-0000-0000-0000-0000000000a1' returning 1$$),
  1, 'project admins change notes'
);
select is(
  tests.attempt('00000000-0000-0000-0000-0000000000c1',
    $$select basic_auth_pass_enc from public.projects$$),
  -1, 'the encrypted password column stays unreadable'
);

-- project slug ------------------------------------------------------------------------------------

select lives_ok(
  $$update public.projects set slug = 'fresh-2' where id = '00000000-0000-0000-0000-0000000000a1'$$,
  'the slug can change before the first run'
);
select throws_ok(
  $$update public.projects set slug = 'used-2' where id = '00000000-0000-0000-0000-0000000000a2'$$,
  '23514', 'The project slug cannot change after the first run',
  'the slug is read-only after the first run'
);
select lives_ok(
  $$update public.projects set name = 'Used!' where id = '00000000-0000-0000-0000-0000000000a2'$$,
  'other settings still change after the first run'
);

-- viewport slugs ----------------------------------------------------------------------------------

select throws_ok(
  $$update public.viewports set slug = 'wide' where id = '00000000-0000-0000-0000-0000000000d2'$$,
  '23514', null, 'a viewport slug used in a run cannot change'
);
select throws_ok(
  $$delete from public.viewports where id = '00000000-0000-0000-0000-0000000000d2'$$,
  '23514', null, 'a viewport used in a run cannot be deleted'
);
select lives_ok(
  $$update public.viewports set enabled = false, width = 1440 where id = '00000000-0000-0000-0000-0000000000d2'$$,
  'a used viewport can still be disabled and resized'
);
select lives_ok(
  $$update public.viewports set slug = 'phone' where id = '00000000-0000-0000-0000-0000000000d3'$$,
  'an unused viewport slug can change'
);
select lives_ok(
  $$delete from public.viewports where id = '00000000-0000-0000-0000-0000000000d3'$$,
  'an unused viewport can be deleted'
);
select lives_ok(
  $$delete from public.projects where id = '00000000-0000-0000-0000-0000000000a2'$$,
  'deleting the project still cascades to used viewports'
);

select * from finish();
rollback;
