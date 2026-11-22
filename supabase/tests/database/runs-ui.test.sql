-- Runs UI: realtime publication and item stats (F-RUN-3, 06 §7, T13). Run with `pnpm test:db`.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- c1 viewer of a1, c2 member of nothing
insert into auth.users (id, email, aud, role)
values
  ('00000000-0000-0000-0000-0000000000c1', 'viewer@test.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000c2', 'outsider@test.local', 'authenticated', 'authenticated');

insert into public.projects (id, slug, name, sitemap_index, r2_bucket)
values ('00000000-0000-0000-0000-0000000000a1', 'runs-ui', 'Runs UI', 'https://example.test/sitemap.xml', 'bucket');
insert into public.project_members (project_id, user_id, role) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', 'viewer');

insert into public.runs (id, project_id, label, status, viewport_slugs)
values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1',
        '2026-11-22_09-00-00', 'running', '{desktop,mobile}');
insert into public.run_items (run_id, url, kind, viewport_slug, filename, status, bytes) values
  ('00000000-0000-0000-0000-0000000000b1', 'https://example.test/', 'page', 'desktop', 'index', 'done', 100),
  ('00000000-0000-0000-0000-0000000000b1', 'https://example.test/a', 'page', 'desktop', 'a', 'done', 50),
  ('00000000-0000-0000-0000-0000000000b1', 'https://example.test/', 'page', 'mobile', 'index', 'failed', null),
  ('00000000-0000-0000-0000-0000000000b1', 'https://example.test/a', 'page', 'mobile', 'a', 'pending', null);

select ok(
  exists (select 1 from pg_publication_tables
          where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'runs'),
  'runs is published to Realtime'
);
select ok(
  not exists (select 1 from pg_publication_tables
              where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'run_items'),
  'run_items is not published (too chatty)'
);

select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000c1', 'role', 'authenticated')::text, true);
set local role authenticated;

select results_eq(
  $$select viewport_slug, status::text, items, bytes
    from public.run_item_stats(array['00000000-0000-0000-0000-0000000000b1']::uuid[])
    order by viewport_slug, status::text$$,
  $$values ('desktop'::text, 'done'::text, 2, 150::bigint),
           ('mobile', 'failed', 1, 0::bigint),
           ('mobile', 'pending', 1, 0::bigint)$$,
  'members get item counts and bytes per viewport and status'
);

reset role;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000c2', 'role', 'authenticated')::text, true);
set local role authenticated;

select is(
  (select count(*)::int from public.run_item_stats(array['00000000-0000-0000-0000-0000000000b1']::uuid[])),
  0, 'non-members get no stats (RLS on run_items)'
);

reset role;
select * from finish();
rollback;
