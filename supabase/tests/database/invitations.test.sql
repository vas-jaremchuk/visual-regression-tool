-- Invite-only sign-up hook (04 §1, REQ-AUTH-1). Run with `pnpm test:db`.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into public.invitations (email, project_id, role, token_hash, expires_at, accepted_at)
values
  ('pending@example.com', '00000000-0000-4000-b000-000000000001', 'viewer', 'hash-pending', now() + interval '1 day', null),
  ('expired@example.com', '00000000-0000-4000-b000-000000000001', 'viewer', 'hash-expired', now() - interval '1 second', null),
  ('accepted@example.com', '00000000-0000-4000-b000-000000000001', 'viewer', 'hash-accepted', now() + interval '1 day', now()),
  ('platform@example.com', null, null, 'hash-platform', now() + interval '1 day', null);

select is(
  public.before_user_created_hook('{"user": {"email": "pending@example.com"}}'),
  '{}'::jsonb,
  'a pending invitation allows sign-up'
);
select is(
  public.before_user_created_hook('{"user": {"email": "Pending@Example.COM"}}'),
  '{}'::jsonb,
  'the email match is case-insensitive'
);
select is(
  public.before_user_created_hook('{"user": {"email": "platform@example.com"}}'),
  '{}'::jsonb,
  'a platform-level invitation allows sign-up'
);
select is(
  public.before_user_created_hook('{"user": {"email": "stranger@example.com"}}') -> 'error' ->> 'http_code',
  '403',
  'an uninvited email is rejected'
);
select is(
  public.before_user_created_hook('{"user": {"email": "expired@example.com"}}') -> 'error' ->> 'message',
  'Not invited',
  'an expired invitation is rejected'
);
select ok(
  public.before_user_created_hook('{"user": {"email": "accepted@example.com"}}') ? 'error',
  'an accepted invitation cannot be used again'
);
select ok(
  public.before_user_created_hook('{"user": {}}') ? 'error',
  'an account without an email is rejected'
);

select ok(
  has_function_privilege('supabase_auth_admin', 'public.before_user_created_hook(jsonb)', 'execute'),
  'Supabase Auth can call the hook'
);
select ok(
  not has_function_privilege('authenticated', 'public.before_user_created_hook(jsonb)', 'execute')
    and not has_function_privilege('anon', 'public.before_user_created_hook(jsonb)', 'execute'),
  'clients cannot call the hook'
);

-- An invitation expires 7 days after it is created (REQ-AUTH-6).
insert into public.invitations (email) values ('default@example.com');
select ok(
  (select expires_at = created_at + interval '7 days' from public.invitations where email = 'default@example.com'),
  'invitations expire after 7 days by default'
);

select * from finish();
rollback;
