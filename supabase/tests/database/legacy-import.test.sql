-- Legacy import (F-RUN-6, T23). Run with `pnpm test:db`.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into public.projects (id, slug, name, sitemap_index, r2_bucket)
values ('00000000-0000-0000-0000-0000000000a1', 'legacy', 'Legacy', 'https://example.test/sitemap.xml', 'bucket');
insert into public.runs (id, project_id, label, status, is_legacy)
values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1',
        '2026-08-07_10-00-00', 'running', true);

select lives_ok(
  $$insert into public.run_items (run_id, url, kind, viewport_slug, filename, status) values
      ('00000000-0000-0000-0000-0000000000b1', null, 'page', 'desktop', 'retired_.png', 'done'),
      ('00000000-0000-0000-0000-0000000000b1', null, 'page', 'desktop', 'gone_.png', 'done'),
      ('00000000-0000-0000-0000-0000000000b1', 'https://example.test/', 'page', 'desktop', 'index.png', 'done')$$,
  'items of a legacy run may have no URL'
);

select throws_ok(
  $$insert into public.run_items (run_id, url, kind, viewport_slug, filename, status)
    values ('00000000-0000-0000-0000-0000000000b1', null, 'page', 'desktop', 'retired_.png', 'done')$$,
  '23505', null,
  'items without a URL stay unique by filename'
);

select public.refresh_run_counts('00000000-0000-0000-0000-0000000000b1');
select is(
  (select total_items from public.runs where id = '00000000-0000-0000-0000-0000000000b1'), 3,
  'items without a URL are counted'
);

select * from finish();
rollback;
