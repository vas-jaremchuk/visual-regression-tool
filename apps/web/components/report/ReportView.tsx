'use client';

import type { ReviewStatus } from '@vrt/shared';
import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  chunk,
  countsFor,
  DEFAULT_FILTER,
  itemPath,
  REPORT_PAGE_SIZE,
  type ItemFilter,
  type ReportCounts,
  type ReviewCounts,
  type StatusFilter,
} from '@/lib/comparisons/report';
import {
  fetchChangedItemIds,
  fetchItemPage,
  fetchReviewCounts,
  type ReportItem,
} from '@/lib/comparisons/report-items';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { IgnoreRuleShortcuts } from './IgnoreRuleShortcuts';
import { ItemViewer, VIEWER_MODES, type ViewerMode } from './ItemViewer';
import { REVIEW_ACTIONS, ReviewToolbar } from './ReviewToolbar';
import { ReviewSummary } from './ReviewSummary';
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
  reviewCounts: Partial<ReviewCounts>;
  /** Editor+: review toolbar, bulk review and keys a / r / i (F-REVIEW-1/2). */
  canReview: boolean;
  canSetBaseline: boolean;
  /** Editor+: ignore-rule shortcuts of the item viewer (F-REVIEW-3). */
  projectId: string;
  canManageRules: boolean;
  /** The project's viewports, offered when scoping a rule. */
  projectViewports: string[];
  afterRunId: string;
  afterIsBaseline: boolean;
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
    a.search === b.search &&
    a.maxPct === b.maxPct
  );
}

/** `reviewRequest` takes at most 1000 ids; larger selections are sent in batches. */
const REVIEW_BATCH = 1000;

const BULK_VERB: Record<Exclude<ReviewStatus, 'pending'>, string> = {
  approved: 'Approve',
  rejected: 'Reject',
  ignored: 'Ignore',
};

type ApiError = { error?: { message?: string } } | null;

/** POST /api/comparisons/:id/review in batches; returns how many items changed. */
async function postReview(
  comparisonId: string,
  itemIds: string[],
  review: ReviewStatus,
  note: string,
): Promise<number> {
  let updated = 0;
  for (const batch of chunk(itemIds, REVIEW_BATCH)) {
    const res = await fetch(`/api/comparisons/${comparisonId}/review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ itemIds: batch, review, ...(note.trim() ? { note } : {}) }),
    });
    const body = (await res.json().catch(() => null)) as ({ updated?: number } & ApiError) | null;
    if (!res.ok) throw new Error(body?.error?.message ?? 'The review could not be saved');
    updated += body?.updated ?? 0;
  }
  return updated;
}

/** Text entry keeps its keys; sliders, buttons and checkboxes do not need letters or digits. */
const NON_TEXT_INPUTS = new Set(['range', 'checkbox', 'radio', 'button', 'submit', 'reset']);

function isTyping(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(target.type);
  return target.isContentEditable || ['TEXTAREA', 'SELECT'].includes(target.tagName);
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
  const [reviewCounts, setReviewCounts] = useState(props.reviewCounts);
  const [note, setNote] = useState(selected?.reviewNote ?? '');
  const [reviewing, setReviewing] = useState<ReviewStatus | null>(null);
  const [bulk, setBulk] = useState<Exclude<ReviewStatus, 'pending'> | null>(null);
  const [bulkPending, setBulkPending] = useState(false);
  const [maxPct, setMaxPct] = useState('');
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

  // The URL search and the diff limit are applied after typing pauses.
  useEffect(() => {
    const limit = maxPct.trim() === '' ? null : Number(maxPct);
    const timer = setTimeout(
      () =>
        applyFilter((f) => ({
          ...f,
          search,
          maxPct: limit !== null && Number.isFinite(limit) && limit >= 0 ? limit : null,
        })),
      300,
    );
    return () => clearTimeout(timer);
  }, [search, maxPct, applyFilter]);

  // Review counts stay live while others review (Realtime on the comparison row).
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`comparison-${comparisonId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'comparisons',
          filter: `id=eq.${comparisonId}`,
        },
        (payload) => {
          const row = payload.new as { review_counts?: Partial<ReviewCounts> | null };
          if (row.review_counts) setReviewCounts(row.review_counts);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [comparisonId]);

  const refreshCounts = useCallback(async () => {
    try {
      setReviewCounts(await fetchReviewCounts(createClient(), comparisonId));
    } catch {
      // Realtime or the next reload brings the counts.
    }
  }, [comparisonId]);

  const select = useCallback(
    (item: ReportItem) => {
      setSelected(item);
      setNote(item.reviewNote ?? '');
      window.history.replaceState(
        null,
        '',
        `/p/${slug}/comparisons/${comparisonId}/items/${item.id}`,
      );
    },
    [slug, comparisonId],
  );

  const canReviewSelected = props.canReview && selected?.status === 'changed';

  const reviewSelected = useCallback(
    async (review: ReviewStatus) => {
      if (!selected || selected.status !== 'changed' || reviewing) return;
      setReviewing(review);
      try {
        await postReview(comparisonId, [selected.id], review, note);
        const reviewNote = review === 'pending' ? null : note.trim() || null;
        const update = (i: ReportItem) => (i.id === selected.id ? { ...i, review, reviewNote } : i);
        setItems((prev) => prev.map(update));
        setSelected((prev) => (prev ? update(prev) : prev));
        if (review === 'pending') setNote('');
        toast.success(review === 'pending' ? 'Review reset' : `Item ${review}`);
        await refreshCounts();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'The review could not be saved');
      } finally {
        setReviewing(null);
      }
    },
    [selected, reviewing, comparisonId, note, refreshCounts],
  );

  const reviewFiltered = async (review: Exclude<ReviewStatus, 'pending'>) => {
    setBulkPending(true);
    try {
      const ids = await fetchChangedItemIds(createClient(), comparisonId, filterRef.current);
      const updated = ids.length === 0 ? 0 : await postReview(comparisonId, ids, review, '');
      toast.success(`${updated} ${updated === 1 ? 'item' : 'items'} ${review}`);
      setBulk(null);
      await Promise.all([load(filterRef.current, 0), refreshCounts()]);
      const reviewed = new Set(ids);
      setSelected((prev) =>
        prev && reviewed.has(prev.id) ? { ...prev, review, reviewNote: null } : prev,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'The review could not be saved');
    } finally {
      setBulkPending(false);
    }
  };

  const scrollIntoList = useCallback((index: number) => {
    const list = listRef.current;
    if (!list) return;
    const top = index * ROW_HEIGHT;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + ROW_HEIGHT > list.scrollTop + list.clientHeight) {
      list.scrollTop = top + ROW_HEIGHT - list.clientHeight;
    }
  }, []);

  // Keyboard (F-CMP-4, F-REVIEW-1): j/k next/prev, a/r/i approve/reject/ignore, 1-4 viewer modes.
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
      const action = REVIEW_ACTIONS.find((a) => a.key === event.key);
      if (action) {
        if (!canReviewSelected) return;
        event.preventDefault();
        void reviewSelected(action.review);
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
  }, [items, selected, select, scrollIntoList, canReviewSelected, reviewSelected]);

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

  const filtered = filter.review !== null || filter.search !== '' || filter.maxPct !== null;
  const canBulk = props.canReview && filter.status === 'changed' && total > 0;
  const threshold = props.changeThresholdPct ?? 0;

  return (
    <div className="grid gap-4">
      <ReviewSummary
        reviewCounts={reviewCounts}
        afterRunId={props.afterRunId}
        afterLabel={props.afterLabel}
        afterIsBaseline={props.afterIsBaseline}
        canSetBaseline={props.canSetBaseline}
      />

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
            <div className="grid w-20 gap-1">
              <Label htmlFor="item-max-pct" className="text-xs">
                Diff &lt; %
              </Label>
              <Input
                id="item-max-pct"
                type="number"
                min={0}
                step="0.1"
                inputMode="decimal"
                value={maxPct}
                onChange={(e) => setMaxPct(e.target.value)}
                placeholder="any"
                className="h-8"
              />
            </div>
          </div>
          {canBulk && (
            <div
              role="group"
              aria-label="Bulk review"
              className="flex flex-wrap items-center gap-1"
            >
              <span className="text-xs text-muted-foreground">All {total} filtered:</span>
              {REVIEW_ACTIONS.map(({ review, icon: Icon }) => (
                <Button
                  key={review}
                  size="sm"
                  variant="outline"
                  className="h-7"
                  disabled={bulkPending || loading}
                  onClick={() => setBulk(review)}
                >
                  <Icon aria-hidden />
                  {BULK_VERB[review]} all
                </Button>
              ))}
            </div>
          )}
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

        <div className="grid min-w-0 content-start gap-3">
          {selected && canReviewSelected && (
            <ReviewToolbar
              item={selected}
              note={note}
              onNoteChange={setNote}
              pending={reviewing}
              onReview={(review) => void reviewSelected(review)}
            />
          )}
          {selected?.url && props.canManageRules && (
            <IgnoreRuleShortcuts
              key={selected.id}
              item={{ ...selected, url: selected.url }}
              projectId={props.projectId}
              comparisonId={comparisonId}
              publicUrl={props.publicUrl}
              viewports={props.projectViewports}
            />
          )}
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

      <Dialog open={bulk !== null} onOpenChange={(open) => !open && !bulkPending && setBulk(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {bulk ? `${BULK_VERB[bulk]} ${total} items?` : 'Review items'}
            </DialogTitle>
            <DialogDescription>
              Every changed item matching the current filters is set to {bulk}, including items not
              loaded in the list yet. Earlier reviews and notes of these items are replaced.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulk(null)} disabled={bulkPending}>
              Cancel
            </Button>
            <Button onClick={() => bulk && void reviewFiltered(bulk)} disabled={bulkPending}>
              {bulkPending && <Loader2 className="animate-spin" aria-hidden />}
              {bulk ? `${BULK_VERB[bulk]} ${total}` : 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
