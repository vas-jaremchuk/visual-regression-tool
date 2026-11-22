-- Legacy import (F-RUN-6, 02 §3): items of imported prototype runs whose URL cannot be
-- reconstructed from a sitemap snapshot keep url = null and are shown by filename.
alter table public.run_items alter column url drop not null;

-- Items without a URL are told apart by filename, which stays unique per run and kind.
create unique index run_items_run_null_url_filename_key
  on public.run_items (run_id, kind, filename)
  where url is null;
