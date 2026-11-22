import {
  diffPrefix,
  reportPrefix,
  runPrefix,
  type CmpItemStatus,
  type ReviewStatus,
} from '@vrt/shared';

/**
 * Report page helpers (F-CMP-2..6, 08 §3) shared by the server page and the client viewer.
 * Pure: no Supabase, no env.
 */

/** Items are paged 100 at a time (NFR-4). */
export const REPORT_PAGE_SIZE = 100;

/** Prototype bands: > 5 % high, > 1 % mid, else low (F-CMP-3). */
export type Severity = 'high' | 'mid' | 'low';

export function severity(pct: number): Severity {
  if (pct > 5) return 'high';
  if (pct > 1) return 'mid';
  return 'low';
}

/** List filter by item status. `compared` is changed + unchanged + error, as the chip counts it. */
export type StatusFilter =
  'compared' | 'changed' | 'unchanged' | 'new' | 'missing' | 'redirect' | 'error';

export function statusesFor(filter: StatusFilter): CmpItemStatus[] {
  return filter === 'compared' ? ['changed', 'unchanged', 'error'] : [filter];
}

export interface ItemFilter {
  status: StatusFilter;
  /** null: all viewports. */
  viewport: string | null;
  review: ReviewStatus | null;
  /** Case-insensitive substring of the URL. */
  search: string;
  /** Only items whose diff is below this percentage (e.g. bulk-approve all < 0.5 %); null: any. */
  maxPct: number | null;
}

export const DEFAULT_FILTER: ItemFilter = {
  status: 'changed',
  viewport: null,
  review: null,
  search: '',
  maxPct: null,
};

export interface PageCounts {
  compared: number;
  changed: number;
  unchanged: number;
  new: number;
  missing: number;
  redirect: number;
  error: number;
}

export interface ReportCounts extends Partial<PageCounts> {
  files_changed?: number;
  files_total?: number;
  viewports?: Record<string, Partial<PageCounts>>;
}

/** Page counters of one viewport tab (null: all viewports). Files have no viewport. */
export function countsFor(counts: ReportCounts, viewport: string | null): PageCounts {
  const source = viewport === null ? counts : (counts.viewports?.[viewport] ?? {});
  return {
    compared: source.compared ?? 0,
    changed: source.changed ?? 0,
    unchanged: source.unchanged ?? 0,
    new: source.new ?? 0,
    missing: source.missing ?? 0,
    redirect: source.redirect ?? 0,
    error: source.error ?? 0,
  };
}

/** Viewport tabs: the compared viewports frozen in the settings, else the counted ones. */
export function viewportTabs(settingsViewports: unknown, counts: ReportCounts): string[] {
  if (Array.isArray(settingsViewports) && settingsViewports.every((v) => typeof v === 'string')) {
    return settingsViewports as string[];
  }
  return Object.keys(counts.viewports ?? {}).sort();
}

/** Display name of an item: the URL path (with query), else the item name. */
export function itemPath(url: string | null, name: string): string {
  if (!url) return name;
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}` || '/';
  } catch {
    return url;
  }
}

/**
 * Image URL of an R2 object (09 §1): `${r2_public_url}/${key}` when the project has a public URL,
 * else the signing endpoint, which redirects to a short-lived signed URL.
 */
export function imageSrc(publicUrl: string | null, comparisonId: string, key: string): string {
  if (publicUrl) return `${publicUrl.replace(/\/+$/, '')}/${key}`;
  const query = new URLSearchParams({ comparison: comparisonId, key, redirect: '1' });
  return `/api/r2/sign?${query.toString()}`;
}

export interface ComparisonKeyScope {
  label: string;
  beforeLabel: string;
  afterLabel: string;
}

/**
 * Whether `key` is an object of this comparison (09 §1): a screenshot or fingerprint of its
 * before/after run, one of its diffs, or its report export. Keys with empty, `.` or `..`
 * segments are refused so a prefix cannot be escaped.
 */
export function keyBelongsToComparison(key: string, scope: ComparisonKeyScope): boolean {
  if (key.length === 0 || key.length > 1024 || key.includes('\\')) return false;
  const segments = key.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) return false;
  let prefixes: string[];
  try {
    prefixes = [
      runPrefix(scope.beforeLabel),
      runPrefix(scope.afterLabel),
      diffPrefix(scope.label),
      reportPrefix(scope.label),
    ];
  } catch {
    return false;
  }
  return prefixes.some((prefix) => key.startsWith(prefix) && key.length > prefix.length);
}

export interface ReviewCounts {
  pending: number;
  approved: number;
  rejected: number;
  ignored: number;
}

/** Reviewed and reviewable (changed) items of a comparison (F-REVIEW-4). */
export function reviewProgress(review: Partial<ReviewCounts>): { reviewed: number; total: number } {
  const reviewed = (review.approved ?? 0) + (review.rejected ?? 0) + (review.ignored ?? 0);
  return { reviewed, total: reviewed + (review.pending ?? 0) };
}

/** F-REVIEW-4: fully reviewed when it has changed items and none of them is pending. */
export function isFullyReviewed(review: Partial<ReviewCounts>): boolean {
  const { reviewed, total } = reviewProgress(review);
  return total > 0 && reviewed === total;
}

/** Splits ids into request-sized batches (`reviewRequest` takes at most 1000). */
export function chunk<T>(values: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < values.length; i += size) batches.push(values.slice(i, i + size));
  return batches;
}
