import { SNAPSHOT_STALE_AFTER_MS } from '@vrt/shared';

/** URL table filters of the snapshot view (F-SITEMAP-2). */
export const SITEMAP_FILTERS = [
  'all',
  'included',
  'excluded',
  'redirects',
  'errors',
  'files',
] as const;
export type SitemapFilter = (typeof SITEMAP_FILTERS)[number];

export const SITEMAP_FILTER_LABELS: Record<SitemapFilter, string> = {
  all: 'All',
  included: 'Included',
  excluded: 'Excluded',
  redirects: 'Redirects',
  errors: 'Errors',
  files: 'Files',
};

export const SITEMAP_PAGE_SIZE = 100;
const MAX_SEARCH_LENGTH = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SitemapQuery {
  snapshotId: string | null;
  filter: SitemapFilter;
  search: string;
  page: number;
}

type RawParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Reads the page's search params; anything invalid falls back to the default. */
export function parseSitemapQuery(params: RawParams): SitemapQuery {
  const snapshot = first(params.snapshot);
  const filter = first(params.filter);
  const page = Number(first(params.page));
  return {
    snapshotId: snapshot && UUID.test(snapshot) ? snapshot.toLowerCase() : null,
    filter: SITEMAP_FILTERS.includes(filter as SitemapFilter) ? (filter as SitemapFilter) : 'all',
    search: (first(params.q) ?? '').trim().slice(0, MAX_SEARCH_LENGTH),
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
}

/** Builds the page URL for a query, omitting default values. */
export function sitemapHref(slug: string, query: Partial<SitemapQuery>): string {
  const params = new URLSearchParams();
  if (query.snapshotId) params.set('snapshot', query.snapshotId);
  if (query.filter && query.filter !== 'all') params.set('filter', query.filter);
  if (query.search) params.set('q', query.search);
  if (query.page && query.page > 1) params.set('page', String(query.page));
  const search = params.toString();
  return `/p/${slug}/sitemap${search ? `?${search}` : ''}`;
}

/** Escapes `%`, `_` and `\` for a Postgres `ilike` pattern. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export interface UrlRowLike {
  url: string;
  kind: 'page' | 'file';
  httpStatus: number | null;
  redirectTo: string | null;
  included: boolean;
}

export function isRedirectRow(row: Pick<UrlRowLike, 'httpStatus' | 'redirectTo'>): boolean {
  return (
    row.redirectTo !== null ||
    (row.httpStatus !== null && row.httpStatus >= 300 && row.httpStatus < 400)
  );
}

/**
 * Whether a row belongs to a filter. `checked` is false when the snapshot skipped the redirect
 * check: then a missing status is not an error. Mirrors the server-side query in `queries.ts`.
 */
export function matchesFilter(row: UrlRowLike, filter: SitemapFilter, checked: boolean): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'included':
      return row.included;
    case 'excluded':
      return !row.included;
    case 'redirects':
      return isRedirectRow(row);
    case 'errors':
      if (isRedirectRow(row)) return false;
      return row.httpStatus === null ? checked : row.httpStatus >= 400;
    case 'files':
      return row.kind === 'file';
  }
}

export function pageCount(total: number, pageSize = SITEMAP_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** F-SITEMAP-5: the latest completed snapshot is stale after 7 days. */
export function isSnapshotStale(createdAt: string, now: number = Date.now()): boolean {
  return now - new Date(createdAt).getTime() > SNAPSHOT_STALE_AFTER_MS;
}
