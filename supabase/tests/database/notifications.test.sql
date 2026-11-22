-- Notifications (F-NOTIFY-1..5, T21). Run with `pnpm test:db`.
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
    when check_violation then return -2;
  end;
end;
$$;

-- d1 viewer of a1, d2 admin of a1, d3 outsider
insert into auth.users (id, email, aud, role)
values
  ('00000000-0000-0000-0000-0000000000d1', 'viewer@test.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000d2', 'padmin@test.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000d3', 'outsider@test.local', 'authenticated', 'authenticated');

insert into public.projects (id, slug, name, sitemap_index, r2_bucket)
values ('00000000-0000-0000-0000-0000000000a1', 'notify', 'Notify', 'https://example.test/sitemap.xml', 'bucket');
insert into public.project_members (project_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', 'viewer'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d2', 'admin');

-- notification_mutes ------------------------------------------------------------------------------

select is(
  tests.attempt('00000000-0000-0000-0000-0000000000d1',
    $$insert into public.notification_mutes (user_id, project_id)
      values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1') returning 1$$),
  1, 'a member mutes a project for themselves');
select is(
  tests.attempt('00000000-0000-0000-0000-0000000000d2',
    $$insert into public.notification_mutes (user_id, project_id)
      values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1') returning 1$$),
  -1, 'nobody mutes for someone else, not even a project admin');
select is(
  tests.attempt('00000000-0000-0000-0000-0000000000d3',
    $$insert into public.notification_mutes (user_id, project_id)
      values ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000a1') returning 1$$),
  -1, 'a user cannot mute a project they cannot view');
insert into public.notification_mutes (user_id, project_id)
values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1');

select is(
  tests.attempt('00000000-0000-0000-0000-0000000000d2',
    $$select 1 from public.notification_mutes$$),
  0, 'mutes are private to their user');
select is(
  tests.attempt('00000000-0000-0000-0000-0000000000d2',
    $$delete from public.notification_mutes returning 1$$),
  0, 'nobody deletes another user''s mute');
select is(
  tests.attempt('00000000-0000-0000-0000-0000000000d1',
    $$delete from public.notification_mutes returning 1$$),
  1, 'a user unmutes');

-- notification_channels ---------------------------------------------------------------------------

select is(
  tests.attempt('00000000-0000-0000-0000-0000000000d2',
    $$insert into public.notification_channels (project_id, type, target_enc, events)
      values ('00000000-0000-0000-0000-0000000000a1', 'slack', 'enc', '{run_failed}') returning 1$$),
  1, 'a project admin adds a Slack channel');
select is(
  tests.attempt('00000000-0000-0000-0000-0000000000d2',
    $$insert into public.notification_channels (project_id, type, events)
      values ('00000000-0000-0000-0000-0000000000a1', 'slack', '{run_failed}') returning 1$$),
  -2, 'a Slack channel needs its webhook URL');
select is(
  tests.attempt('00000000-0000-0000-0000-0000000000d2',
    $$insert into public.notification_channels (project_id, type, events)
      values ('00000000-0000-0000-0000-0000000000a1', 'email', '{comparison_changed}') returning 1$$),
  1, 'an email channel without an address goes to all members');
select is(
  tests.attempt('00000000-0000-0000-0000-0000000000d1',
    $$insert into public.notification_channels (project_id, type, target, events)
      values ('00000000-0000-0000-0000-0000000000a1', 'email', 'a@test.local', '{}') returning 1$$),
  -1, 'a viewer cannot add a channel');
select is(
  tests.attempt('00000000-0000-0000-0000-0000000000d2',
    $$select target_enc from public.notification_channels$$),
  -1, 'the encrypted webhook URL is never readable by users');

select * from finish();
rollback;
