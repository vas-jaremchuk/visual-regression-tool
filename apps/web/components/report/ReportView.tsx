'use client';

import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  countsFor,
  DEFAULT_FILTER,
  itemPath,
  REPORT_PAGE_SIZE,
  type ItemFilter,
  type ReportCounts,
  type StatusFilter,
} from '@/lib/comparisons/report';
import { fetchItemPage, type ReportItem } from '@/lib/comparisons/report-items';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { ItemViewer, VIEWER_MODES, type ViewerMode } from './ItemViewer';
import { SeverityBadge } from './SeverityBadge';

export interface ReportViewProps {
  slug: string;
  comparisonId: string;
  publicUrl: string | null;
  beforeLabel: string;
  afterLabel: string;
  counts: ReportCounts;
  viewports: string[];
  changeThresholdPct: number | null;
  /** First page for `DEFAULT_FILTER`, rendered on the server (NFR-4). */
  initialItems: ReportItem[];
  initialTotal: number;
  /** Deep-linked item (08 §1 item route), shown even when it is not in the loaded page. */
  initialItem: ReportItem | null;
}

const ROW_HEIGHT = 44;
const OVERSCAN = 8;
const LIST_HEIGHT = 560;

/** Summary chips (F-CMP-2) in prototype order and colours; each one filters the list. */
const CHIPS: { status: StatusFilter; label: string; icon: string; className: string }[] = [
  {
    status: 'compared',
    label: 'compared',
    icon: '📄',
    className: 'border-[#2d3748] bg-[#1e2433] text-[#94a3b8]',
  },
  {
    status: 'changed',
    label: 'changed',
    icon: '🔴',
    className: 'border-[#7f1d1d] bg-[#3b1f2b] text-[#f87171]',
  },
  {
    status: 'unchanged',
    label: 'unchanged',
    icon: '✅',
    className: 'border-[#14532d] bg-[#1a2e22] text-[#4ade80]',
  },
  {
    status: 'new',
    label: 'new',
    icon: '🆕',
    className: 'border-[#1e40af] bg-[#1c2c42] text-[#60a5fa]',
  },
  {
    status: 'missing',
    label: 'missing',
    icon: '⚠️',
    className: 'border-[#7c2d12] bg-[#2a1f10] text-[#fb923c]',
  },
  {
    status: 'redirect',
    label: 'redirected',
    icon: '↪️',
    className: 'border-[#5b21b6] bg-[#261f3a] text-[#a78bfa]',
  },
  {
    status: 'error',
    label: 'errors',
    icon: '❗',
    className: 'border-[#7f1d1d] bg-[#3b1f2b] text-[#fca5a5]',
  },
];

const REVIEW_DOT: Record<ReportItem['review'], string> = {
  pending: 'bg-slate-500',
  approved: 'bg-emerald-500',
  rejected: 'bg-red-500',
  ignored: 'bg-amber-400',
};

function sameFilter(a: ItemFilter, b: ItemFilter) {
  return (
    a.status === b.status &&
    a.viewport === b.viewport &&
    a.review === b.review &&
    a.search === b.search
  );
}

function isTyping(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

/** Report screen (08 §3): chips, viewport tabs, virtualised list and item viewer. */
export function ReportView(props: ReportViewProps) {
  const { slug, comparisonId, counts, viewports } = props;
  const [filter, setFilter] = useState<ItemFilter>(DEFAULT_FILTER);
  const [search, setSearch] = useState('');
  const [items, setItems] = useState(props.initialItems);
  const [total, setTotal] = useState(props.initialTotal);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReportItem | null>(
    props.initialItem ?? props.initialItems[0] ?? null,
  );
  const [mode, setMode] = useState<ViewerMode>('side-by-side');
  const [scrollTop, setScrollTop] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const request = useRef(0);
  const loadedFilter = useRef<ItemFilter>(DEFAULT_FILTER);
  const filterRef = useRef<ItemFilter>(DEFAULT_FILTER);

  const load = useCallback(
    async (next: ItemFilter, offset: number) => {
      const token = ++request.current;
      setLoading(true);
      setError(null);
      try {
        const page = await fetchItemPage(createClient(), comparisonId, next, offset, {
          count: offset === 0,
        });
        if (token !== request.current) return;
        loadedFilter.current = next;
        setItems((prev) => (offset === 0 ? page.items : [...prev, ...page.items]));
        if (page.total !== null) setTotal(page.total);
      } catch (e) {
        if (token === request.current) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (token === request.current) setLoading(false);
      }
    },
    [comparisonId],
  );

  // A new filter reloads the list from the first page.
  const applyFilter = useCallback(
    (update: (f: ItemFilter) => ItemFilter) => {
      const next = update(filterRef.current);
      if (sameFilter(next, filterRef.current)) return;
      filterRef.current = next;
      setFilter(next);
      setScrollTop(0);
      listRef.current?.scrollTo({ top: 0 });
      void load(next, 0);
    },
    [load],
  );

  // The URL search is applied after typing pauses.
  useEffect(() => {
    const timer = setTimeout(() => applyFilter((f) => ({ ...f, search })), 300);
    return () => clearTimeout(timer);
  }, [search, applyFilter]);

  const select = useCallback(
    (item: ReportItem) => {
      setSelected(item);
      window.history.replaceState(
        null,
        '',
        `/p/${slug}/comparisons/${comparisonId}/items/${item.id}`,
      );
    },
    [slug, comparisonId],
  );

  const scrollIntoList = useCallback((index: number) => {
    const list = listRef.current;
    if (!list) return;
    const top = index * ROW_HEIGHT;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + ROW_HEIGHT > list.scrollTop + list.clientHeight) {
      list.scrollTop = top + ROW_HEIGHT - list.clientHeight;
    }
  }, []);

  // Keyboard (F-CMP-4): j/k next/prev, 1-4 viewer modes. Review keys come with review actions.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (isTyping(event.target)) return;
      if (event.key === 'j' || event.key === 'k') {
        if (items.length === 0) return;
        const current = selected ? items.findIndex((i) => i.id === selected.id) : -1;
        const index =
          event.key === 'j'
            ? Math.min(items.length - 1, current + 1)
            : Math.max(0, current === -1 ? 0 : current - 1);
        const item = items[index];
        if (item) {
          event.preventDefault();
          select(item);
          scrollIntoList(index);
        }
        return;
      }
      const modeIndex = Number(event.key) - 1;
      const next = VIEWER_MODES[modeIndex];
      if (Number.isInteger(modeIndex) && next) {
        event.preventDefault();
        setMode(next.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [items, selected, select, scrollIntoList]);

  const tabCounts = countsFor(counts, filter.viewport);
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(items.length, Math.ceil((scrollTop + LIST_HEIGHT) / ROW_HEIGHT) + OVERSCAN);
  const canLoadMore = items.length < total && items.length % REPORT_PAGE_SIZE === 0;

  // Infinite scroll: fetch the next page when the window nears the end of the loaded rows.
  const onListScroll = (top: number) => {
    setScrollTop(top);
    const last = Math.ceil((top + LIST_HEIGHT) / ROW_HEIGHT) + OVERSCAN;
    if (!sameFilter(filter, loadedFilter.current) || loading || error || !canLoadMore) return;
    if (last >= items.length - OVERSCAN) void load(filter, items.length);
  };

  const filtered = filter.review !== null || filter.search !== '';
  const threshold = props.changeThresholdPct ?? 0;

  return (
    <div className="grid gap-4">
      <div role="group" aria-label="Summary" className="flex flex-wrap gap-2">
        {CHIPS.filter((c) => c.status !== 'error' || tabCounts.error > 0).map((chip) => (
          <button
            key={chip.status}
            type="button"
            aria-pressed={filter.status === chip.status}
            onClick={() => applyFilter((f) => ({ ...f, status: chip.status }))}
            className={cn(
              'rounded-full border px-3.5 py-1.5 text-xs font-semibold tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-[#818cf8]',
              chip.className,
              filter.status === chip.status && 'ring-2 ring-[#818cf8]',
            )}
          >
            <span aria-hidden>{chip.icon}</span> {tabCounts[chip.status]} {chip.label}
          </button>
        ))}
        {(counts.files_total ?? 0) > 0 && (
          <a
            href="#files"
            className="rounded-full border border-[#713f12] bg-[#2a2410] px-3.5 py-1.5 text-xs font-semibold text-[#facc15] tabular-nums"
          >
            <span aria-hidden>📎</span> {counts.files_changed ?? 0} / {counts.files_total} files
            changed
          </a>
        )}
      </div>

      {viewports.length > 0 && (
        <div role="tablist" aria-label="Viewports" className="flex flex-wrap gap-1 border-b">
          {[null, ...viewports].map((vp) => (
            <button
              key={vp ?? 'all'}
              type="button"
              role="tab"
              aria-selected={filter.viewport === vp}
              onClick={() => applyFilter((f) => ({ ...f, viewport: vp }))}
              className={cn(
                '-mb-px border-b-2 px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[#818cf8]',
                filter.viewport === vp
                  ? 'border-[#818cf8] font-medium'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {vp ?? 'All'}
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <section aria-labelledby="items-heading" className="grid content-start gap-2">
          <h2 id="items-heading" className="sr-only">
            Items
          </h2>
          <div className="flex gap-2">
            <div className="grid flex-1 gap-1">
              <Label htmlFor="item-search" className="text-xs">
                Search URL
              </Label>
              <Input
                id="item-search"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="/path"
                className="h-8"
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="item-review" className="text-xs">
                Review
              </Label>
              <select
                id="item-review"
                value={filter.review ?? ''}
                onChange={(e) =>
                  applyFilter((f) => ({
                    ...f,
                    review: (e.target.value || null) as ItemFilter['review'],
                  }))
                }
                className="h-8 rounded-md border bg-background px-2 text-sm"
              >
                <option value="">All</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option value="ignored">Ignored</option>
              </select>
            </div>
          </div>
          <p className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
            <span className="tabular-nums">
              {total} {total === 1 ? 'item' : 'items'}
            </span>
            {loading && (
              <>
                <Loader2 className="size-3 animate-spin" aria-hidden />
                Loading…
              </>
            )}
          </p>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}{' '}
              <button
                type="button"
                className="underline"
                onClick={() => void load(filter, items.length === 0 ? 0 : items.length)}
              >
                Try again
              </button>
            </p>
          )}
          {items.length === 0 && !loading && !error ? (
            filter.status === 'changed' && !filtered ? (
              <div className="rounded-lg border border-[#14532d] bg-[#1a2e22] px-5 py-4 font-medium text-[#4ade80]">
                ✅ No visual differences detected above the {threshold}% threshold.
              </div>
            ) : (
              <p className="rounded-md border p-4 text-sm text-muted-foreground">
                No items match these filters.
              </p>
            )
          ) : (
            <div
              ref={listRef}
              role="listbox"
              aria-label="Items"
              data-testid="item-list"
              tabIndex={-1}
              onScroll={(e) => onListScroll(e.currentTarget.scrollTop)}
              className="overflow-y-auto rounded-md border"
              style={{ height: Math.min(LIST_HEIGHT, Math.max(items.length, 1) * ROW_HEIGHT + 2) }}
            >
              <div style={{ height: items.length * ROW_HEIGHT, position: 'relative' }}>
                {items.slice(start, end).map((item, i) => {
                  const index = start + i;
                  const active = selected?.id === item.id;
                  return (
                    <div
                      key={item.id}
                      role="option"
                      aria-selected={active}
                      tabIndex={0}
                      onClick={() => select(item)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          select(item);
                        }
                      }}
                      className={cn(
                        'absolute inset-x-0 flex cursor-pointer items-center gap-2 border-b px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#818cf8]',
                        active ? 'bg-[#1a1f2e]' : 'hover:bg-muted/50',
                      )}
                      style={{ top: index * ROW_HEIGHT, height: ROW_HEIGHT }}
                    >
                      <span
                        className={cn('size-2 shrink-0 rounded-full', REVIEW_DOT[item.review])}
                        title={`Review: ${item.review}`}
                      />
                      <span className="sr-only">Review {item.review}.</span>
                      <span
                        className="min-w-0 flex-1 truncate font-mono text-xs"
                        title={item.url ?? item.name}
                      >
                        {itemPath(item.url, item.name)}
                      </span>
                      {item.viewportSlug && filter.viewport === null && (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {item.viewportSlug}
                        </span>
                      )}
                      {item.diffPct !== null ? (
                        <SeverityBadge pct={item.diffPct} />
                      ) : (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {item.status}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        <div className="min-w-0">
          {selected ? (
            <ItemViewer
              item={selected}
              comparisonId={comparisonId}
              publicUrl={props.publicUrl}
              beforeLabel={props.beforeLabel}
              afterLabel={props.afterLabel}
              mode={mode}
              onModeChange={setMode}
            />
          ) : (
            <p className="rounded-md border p-6 text-sm text-muted-foreground">
              Select an item to compare its screenshots.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
