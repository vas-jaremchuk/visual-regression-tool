import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@vrt/db';
import type { CmpItemStatus, ReviewStatus } from '@vrt/shared';
import { escapeLike } from '../sitemap/filters';
import { REPORT_PAGE_SIZE, statusesFor, type ItemFilter } from './report';

/**
 * Report list pages (F-CMP-3, NFR-4): page items sorted by diff % desc, 100 at a time. Takes either
 * the server or the browser Supabase client; RLS limits rows to comparisons the user can view.
 */

export interface ReportItem {
  id: string;
  url: string | null;
  name: string;
  viewportSlug: string | null;
  status: CmpItemStatus;
  diffPct: number | null;
  diffPixels: number | null;
  totalPixels: number | null;
  beforeKey: string | null;
  afterKey: string | null;
  diffKey: string | null;
  beforeDims: number[] | null;
  afterDims: number[] | null;
  review: ReviewStatus;
  error: string | null;
}

export const REPORT_ITEM_COLUMNS =
  'id, url, name, viewport_slug, status, diff_pct, diff_pixels, total_pixels, before_key, ' +
  'after_key, diff_key, before_dims, after_dims, review, error';

type ItemRow = Pick<
  Database['public']['Tables']['comparison_items']['Row'],
  | 'id'
  | 'url'
  | 'name'
  | 'viewport_slug'
  | 'status'
  | 'diff_pct'
  | 'diff_pixels'
  | 'total_pixels'
  | 'before_key'
  | 'after_key'
  | 'diff_key'
  | 'before_dims'
  | 'after_dims'
  | 'review'
  | 'error'
>;

export function toReportItem(row: ItemRow): ReportItem {
  return {
    id: row.id,
    url: row.url,
    name: row.name,
    viewportSlug: row.viewport_slug,
    status: row.status,
    diffPct: row.diff_pct === null ? null : Number(row.diff_pct),
    diffPixels: row.diff_pixels,
    totalPixels: row.total_pixels,
    beforeKey: row.before_key,
    afterKey: row.after_key,
    diffKey: row.diff_key,
    beforeDims: row.before_dims,
    afterDims: row.after_dims,
    review: row.review,
    error: row.error,
  };
}

export interface ItemPage {
  items: ReportItem[];
  /** Rows matching the filter; null when not requested. */
  total: number | null;
}

export async function fetchItemPage(
  supabase: SupabaseClient<Database>,
  comparisonId: string,
  filter: ItemFilter,
  offset: number,
  options: { count?: boolean } = {},
): Promise<ItemPage> {
  let query = supabase
    .from('comparison_items')
    .select(REPORT_ITEM_COLUMNS, options.count ? { count: 'exact' } : undefined)
    .eq('comparison_id', comparisonId)
    .eq('kind', 'page')
    .in('status', statusesFor(filter.status));
  if (filter.viewport !== null) query = query.eq('viewport_slug', filter.viewport);
  if (filter.review !== null) query = query.eq('review', filter.review);
  if (filter.search.trim()) query = query.ilike('url', `%${escapeLike(filter.search.trim())}%`);
  const { data, error, count } = await query
    .order('diff_pct', { ascending: false, nullsFirst: false })
    .order('url', { ascending: true })
    .order('viewport_slug', { ascending: true })
    .range(offset, offset + REPORT_PAGE_SIZE - 1);
  if (error) throw new Error(`Could not load the items: ${error.message}`);
  const rows = (data ?? []) as unknown as ItemRow[];
  return { items: rows.map(toReportItem), total: options.count ? (count ?? 0) : null };
}
