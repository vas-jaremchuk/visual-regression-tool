-- T13: runs UI with realtime progress (F-RUN-3, 06 §7).
-- Forward-only (NFR-24).

-- The run detail page and the active-job indicator subscribe to `runs` rows (not to run_items:
-- too chatty). RLS (runs_select) applies to Realtime postgres_changes too.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.runs;
  end if;
end;
$$;

-- Item counts and stored bytes per run, viewport and status: the runs list (size) and the
-- per-viewport progress bar of the run detail. Security invoker: RLS on run_items applies.
create function public.run_item_stats(p_run_ids uuid[])
returns table (run_id uuid, viewport_slug text, status public.item_status, items int, bytes bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select i.run_id, i.viewport_slug, i.status, count(*)::int, coalesce(sum(i.bytes), 0)::bigint
  from public.run_items i
  where i.run_id = any (p_run_ids)
  group by i.run_id, i.viewport_slug, i.status;
$$;

revoke execute on function public.run_item_stats(uuid[]) from public, anon;
grant execute on function public.run_item_stats(uuid[]) to authenticated;
