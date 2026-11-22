-- Rate limits (T25, NFR-17): consume_rate_limit keeps a per-user sliding window. Run with
-- `pnpm test:db`.
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

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000d1', 'one@test.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000d2', 'two@test.local', 'authenticated', 'authenticated');

-- Ten hits in the window are allowed, the eleventh is refused with a retry-after.
select is(
  (select array_agg(tests.run_as('00000000-0000-0000-0000-0000000000d1',
     $q$select public.consume_rate_limit('job_start', 10, 60)::text$q$)::int)
     from generate_series(1, 10)),
  array_fill(0, array[10]),
  'the first 10 job starts in a minute are allowed'
);

select cmp_ok(
  tests.run_as('00000000-0000-0000-0000-0000000000d1',
    $q$select public.consume_rate_limit('job_start', 10, 60)::text$q$)::int,
  '>', 0,
  'the 11th job start in a minute is refused with a retry-after'
);

select is(
  (select count(*)::int from public.rate_limit_hits
    where user_id = '00000000-0000-0000-0000-0000000000d1'),
  10,
  'a refused request is not recorded'
);

-- The limit is per user and per bucket.
select is(
  tests.run_as('00000000-0000-0000-0000-0000000000d2',
    $q$select public.consume_rate_limit('job_start', 10, 60)::text$q$)::int,
  0,
  'another user has their own window'
);

select is(
  tests.run_as('00000000-0000-0000-0000-0000000000d1',
    $q$select public.consume_rate_limit('other', 10, 60)::text$q$)::int,
  0,
  'another bucket has its own window'
);

-- Hits older than the window no longer count and are pruned.
update public.rate_limit_hits set created_at = now() - interval '61 seconds'
 where user_id = '00000000-0000-0000-0000-0000000000d1' and bucket = 'job_start';

select is(
  tests.run_as('00000000-0000-0000-0000-0000000000d1',
    $q$select public.consume_rate_limit('job_start', 10, 60)::text$q$)::int,
  0,
  'requests are allowed again once the window has passed'
);

select is(
  (select count(*)::int from public.rate_limit_hits
    where user_id = '00000000-0000-0000-0000-0000000000d1' and bucket = 'job_start'),
  1,
  'expired hits are pruned'
);

-- Users cannot read or write the table directly, and anon cannot call the RPC.
select throws_ok(
  $$select tests.run_as('00000000-0000-0000-0000-0000000000d1',
    'select count(*)::text from public.rate_limit_hits')$$,
  '42501', null,
  'authenticated users cannot read rate_limit_hits'
);

select throws_ok(
  $$select tests.run_as('00000000-0000-0000-0000-0000000000d1',
    $q$insert into public.rate_limit_hits (user_id, bucket)
       values ('00000000-0000-0000-0000-0000000000d1', 'job_start') returning 'x'$q$)$$,
  '42501', null,
  'authenticated users cannot insert into rate_limit_hits'
);

set local role anon;
select throws_ok(
  $$select public.consume_rate_limit('job_start', 10, 60)$$,
  '42501', null,
  'anon cannot call consume_rate_limit'
);
reset role;

select * from finish();
rollback;
