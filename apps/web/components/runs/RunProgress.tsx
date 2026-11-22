'use client';

import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { RunStatusBadge } from '@/components/runs/RunStatusBadge';
import {
  addSample,
  estimateEtaMs,
  formatDuration,
  isActiveRun,
  pendingOf,
  percentOf,
  type ProgressSample,
  type ViewportProgress,
} from '@/lib/runs/progress';
import { createClient } from '@/lib/supabase/client';

export interface RunProgressState {
  id: string;
  status: string;
  total: number;
  done: number;
  failed: number;
  startedAt: string | null;
}

/** Server refreshes (per-viewport counts, items table) at most this often while running. */
const REFRESH_MS = 3_000;

/**
 * F-RUN-3 / 06 §7: live progress of a run. Subscribes to Realtime changes of this single `runs`
 * row (not to items); counts and ETA update from the row, and the page is refreshed (throttled)
 * for the per-viewport segments and the items table.
 */
export function RunProgress({
  initial,
  viewports,
}: {
  initial: RunProgressState;
  viewports: ViewportProgress[];
}) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [samples, setSamples] = useState<ProgressSample[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const lastRefresh = useRef(0);
  const status = useRef(initial.status);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A server refresh carries counts at least as new as the last Realtime event.
  const [shown, setShown] = useState(initial);
  if (initial !== shown) {
    setShown(initial);
    if (
      initial.done + initial.failed >= state.done + state.failed ||
      initial.status !== state.status
    ) {
      setState(initial);
    }
  }

  useEffect(() => {
    const supabase = createClient();
    const refresh = (immediate: boolean) => {
      if (timer.current) return;
      const wait = immediate ? 0 : Math.max(0, lastRefresh.current + REFRESH_MS - Date.now());
      timer.current = setTimeout(() => {
        timer.current = null;
        lastRefresh.current = Date.now();
        router.refresh();
      }, wait);
    };
    const channel = supabase
      .channel(`run-${initial.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'runs', filter: `id=eq.${initial.id}` },
        (payload) => {
          const row = payload.new as {
            status: string;
            total_items: number;
            done_items: number;
            failed_items: number;
            started_at: string | null;
          };
          const changed = row.status !== status.current;
          status.current = row.status;
          setState({
            id: initial.id,
            status: row.status,
            total: row.total_items,
            done: row.done_items,
            failed: row.failed_items,
            startedAt: row.started_at,
          });
          const at = Date.now();
          setNow(at);
          setSamples((current) =>
            addSample(current, { at, processed: row.done_items + row.failed_items }),
          );
          refresh(changed);
        },
      )
      .subscribe();
    return () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      void supabase.removeChannel(channel);
    };
  }, [initial.id, router]);

  const active = isActiveRun(state.status);
  useEffect(() => {
    if (!active) return;
    const tick = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(tick);
  }, [active]);

  const pending = pendingOf(state);
  const eta = active
    ? estimateEtaMs(state, samples, state.startedAt ? Date.parse(state.startedAt) : null, now)
    : null;
  const segmentTotal = viewports.reduce((n, v) => n + v.total, 0);

  return (
    <section aria-label="Run progress" className="grid gap-3 rounded-lg border p-4">
      <div role="status" aria-live="polite" className="flex flex-wrap items-center gap-3 text-sm">
        {active && <Loader2 className="size-4 animate-spin" aria-hidden />}
        <RunStatusBadge status={state.status} />
        <span data-testid="run-counts" className="tabular-nums">
          {state.done} done · {state.failed} failed · {pending} pending · {state.total} items
        </span>
        {active && (
          <span className="text-muted-foreground">
            {eta === null ? 'ETA: estimating…' : `ETA: ≈ ${formatDuration(eta)}`}
          </span>
        )}
      </div>
      <div
        role="progressbar"
        aria-label="Items finished"
        aria-valuemin={0}
        aria-valuemax={state.total}
        aria-valuenow={state.done + state.failed}
        className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-muted"
      >
        {viewports.map((v) => (
          <div
            key={v.viewportSlug ?? '_files'}
            className="flex h-full bg-muted-foreground/20"
            style={{ width: `${segmentTotal > 0 ? (v.total / segmentTotal) * 100 : 0}%` }}
          >
            <div
              className="h-full bg-emerald-600"
              style={{ width: `${percentOf(v.done, v.total)}%` }}
            />
            <div
              className="h-full bg-destructive"
              style={{ width: `${percentOf(v.failed, v.total)}%` }}
            />
          </div>
        ))}
      </div>
      <ul aria-label="Progress per viewport" className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
        {viewports.map((v) => (
          <li key={v.viewportSlug ?? '_files'} className="tabular-nums">
            <span className="font-medium">{v.viewportSlug ?? 'files'}</span>{' '}
            <span className="text-muted-foreground">
              {v.done}/{v.total} done{v.failed > 0 ? ` · ${v.failed} failed` : ''}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
