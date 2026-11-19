-- Local development seed (never run against production).
-- Users sign in with a magic link (local Inbucket/Mailpit) or the password `password123`.
--   admin@example.com   platform admin
--   editor@example.com  editor of "Example site"
--   viewer@example.com  viewer of "Example site"

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new
)
select
  '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
  extensions.crypt('password123', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', u.full_name),
  now(), now(), '', '', '', ''
from (values
  ('00000000-0000-4000-a000-000000000001'::uuid, 'admin@example.com', 'Platform Admin'),
  ('00000000-0000-4000-a000-000000000002'::uuid, 'editor@example.com', 'Editor'),
  ('00000000-0000-4000-a000-000000000003'::uuid, 'viewer@example.com', 'Viewer')
) as u (id, email, full_name);

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.id::text, jsonb_build_object('sub', u.id::text, 'email', u.email),
       'email', now(), now(), now()
from auth.users u
where u.id in (
  '00000000-0000-4000-a000-000000000001',
  '00000000-0000-4000-a000-000000000002',
  '00000000-0000-4000-a000-000000000003'
);

-- profiles rows are created by the on_auth_user_created trigger
update public.profiles set is_platform_admin = true where id = '00000000-0000-4000-a000-000000000001';

insert into public.projects (id, slug, name, sitemap_index, r2_bucket, created_by)
values (
  '00000000-0000-4000-b000-000000000001', 'example-site', 'Example site',
  'http://localhost:4010/sitemap_index.xml', 'vrt-example-site',
  '00000000-0000-4000-a000-000000000001'
);

insert into public.viewports (project_id, slug, width, height, sort_order)
values ('00000000-0000-4000-b000-000000000001', 'desktop', 1280, 900, 0);

insert into public.project_members (project_id, user_id, role)
values
  ('00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000002', 'editor'),
  ('00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000003', 'viewer');
