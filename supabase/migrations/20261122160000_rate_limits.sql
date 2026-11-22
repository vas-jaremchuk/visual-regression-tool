-- T25: per-user rate limit for job start endpoints (NFR-17). The web app runs on serverless
-- functions without shared memory, so the sliding window lives in Postgres.

-- 1. rate_limit_hits: one row per accepted request, pruned on every call ------------------------
create table public.rate_limit_hits (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  bucket     text not null,
  created_at timestamptz not null default now()
);

create index rate_limit_hits_user_bucket_idx
  on public.rate_limit_hits (user_id, bucket, created_at);

-- Only consume_rate_limit() touches the table; no policy grants direct access.
alter table public.rate_limit_hits enable row level security;
revoke all on public.rate_limit_hits from anon, authenticated;

-- 2. consume_rate_limit: records a hit for the caller and returns 0, or returns the seconds until
-- the oldest hit in the window expires when the caller already made p_limit requests in it.
create function public.consume_rate_limit(p_bucket text, p_limit int, p_window_seconds int)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_since timestamptz := now() - make_interval(secs => p_window_seconds);
  v_count int;
  v_oldest timestamptz;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;
  if p_limit < 1 or p_window_seconds < 1 then
    raise exception 'invalid rate limit' using errcode = 'invalid_parameter_value';
  end if;

  -- Serialise concurrent requests of one user on one bucket.
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text || ':' || p_bucket, 0));

  delete from public.rate_limit_hits
   where user_id = v_uid and bucket = p_bucket and created_at <= v_since;

  select count(*), min(created_at) into v_count, v_oldest
    from public.rate_limit_hits
   where user_id = v_uid and bucket = p_bucket;

  if v_count >= p_limit then
    return greatest(1, ceil(extract(epoch from (v_oldest - v_since)))::int);
  end if;

  insert into public.rate_limit_hits (user_id, bucket) values (v_uid, p_bucket);
  return 0;
end;
$$;

revoke all on function public.consume_rate_limit(text, int, int) from public, anon;
grant execute on function public.consume_rate_limit(text, int, int) to authenticated;
