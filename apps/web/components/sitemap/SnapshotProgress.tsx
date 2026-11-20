'use client';

import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export interface ProgressState {
  id: string;
  status: string;
  childSitemaps: number;
  urlsChecked: number;
  urlsTotal: number;
  error: string | null;
}

/**
 * F-SITEMAP-1 / 06 §7: live progress of a running snapshot. Subscribes to Realtime changes of
 * this single `sitemap_snapshots` row and refreshes the page once the fetch has finished.
 */
export function SnapshotProgress({ initial }: { initial: ProgressState }) {
  const router = useRouter();
  const [state, setState] = useState(initial);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`sitemap-snapshot-${initial.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'sitemap_snapshots',
          filter: `id=eq.${initial.id}`,
        },
        (payload) => {
          const row = payload.new as {
            status: string;
            child_sitemaps: number;
            urls_checked: number;
            urls_total: number;
            error: string | null;
          };
          setState({
            id: initial.id,
            status: row.status,
            childSitemaps: row.child_sitemaps,
            urlsChecked: row.urls_checked,
            urlsTotal: row.urls_total,
            error: row.error,
          });
          if (row.status !== 'running') router.refresh();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [initial.id, router]);

  const pct =
    state.urlsTotal > 0
      ? Math.min(100, Math.round((state.urlsChecked / state.urlsTotal) * 100))
      : 0;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Sitemap fetch progress"
      className="grid gap-2 rounded-lg border p-4"
    >
      <p className="flex items-center gap-2 text-sm font-medium">
        {state.status === 'running' && <Loader2 className="size-4 animate-spin" aria-hidden />}
        {state.status === 'running'
          ? 'Fetching sitemap…'
          : state.status === 'completed'
            ? 'Sitemap fetch completed'
            : 'Sitemap fetch failed'}
      </p>
      <p className="text-sm text-muted-foreground">
        {state.childSitemaps} child sitemap{state.childSitemaps === 1 ? '' : 's'} fetched
        {state.urlsTotal > 0 && ` · ${state.urlsChecked} / ${state.urlsTotal} URLs checked`}
      </p>
      {state.urlsTotal > 0 && (
        <div
          role="progressbar"
          aria-label="URLs checked"
          aria-valuemin={0}
          aria-valuemax={state.urlsTotal}
          aria-valuenow={state.urlsChecked}
          className="h-2 overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
      )}
      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
    </div>
  );
}
