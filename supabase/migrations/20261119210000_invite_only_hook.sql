-- T07: invite-only sign-up (04 §1, REQ-AUTH-1). Forward-only (NFR-24).
--
-- Supabase Auth calls this "before user created" hook (supabase/config.toml
-- [auth.hook.before_user_created]) for every new account: magic link, OAuth and the admin API.
-- The account is created only when a pending, unexpired invitation exists for the email
-- (case-insensitive). Revoked invitations are deleted, so they never match.

create function public.before_user_created_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email text := lower(event -> 'user' ->> 'email');
begin
  if v_email is not null and exists (
    select 1
    from public.invitations i
    where i.email = v_email
      and i.accepted_at is null
      and i.expires_at > now()
  ) then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'error', jsonb_build_object('http_code', 403, 'message', 'Not invited')
  );
end;
$$;

revoke execute on function public.before_user_created_hook(jsonb) from public, anon, authenticated;
grant execute on function public.before_user_created_hook(jsonb) to supabase_auth_admin, service_role;
