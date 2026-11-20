-- T10: sitemap snapshot progress and realtime (F-SITEMAP-1, 06 §7).
-- Forward-only (NFR-24).

-- Live progress of the redirect check: URLs checked so far out of the URLs to check.
alter table public.sitemap_snapshots
  add column urls_checked int not null default 0 check (urls_checked >= 0),
  add column urls_total   int not null default 0 check (urls_total >= 0),
  add column finished_at  timestamptz;

-- The sitemap page subscribes to the running snapshot row (not to sitemap_urls: too chatty).
-- RLS (sitemap_snapshots_select) applies to Realtime postgres_changes too.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.sitemap_snapshots;
  end if;
end;
$$;
