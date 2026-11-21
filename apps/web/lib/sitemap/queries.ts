import 'server-only';
import { diffSnapshotUrls } from '@vrt/engine';
import { createClient } from '../supabase/server';
import {
  SITEMAP_FILTERS,
  SITEMAP_PAGE_SIZE,
  escapeLike,
  type SitemapFilter,
  type SitemapQuery,
} from './filters';

type UserClient = Awaited<ReturnType<typeof createClient>>;

/** PostgREST returns at most this many rows per request. */
const FETCH_CHUNK = 1_000;

export type SnapshotStatus = 'running' | 'completed' | 'failed';

export interface SnapshotSummary {
  id: string;
  status: SnapshotStatus;
  sourceUrl: string;
  childSitemaps: number;
  urlCount: number;
  redirectCount: number;
  errorCount: number;
  urlsChecked: number;
  urlsTotal: number;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface SnapshotUrlRow {
  id: string;
  url: string;
  kind: 'page' | 'file';
  httpStatus: number | null;
  redirectTo: string | null;
  included: boolean;
  source: string;
}

const SNAPSHOT_SELECT =
  'id, status, source_url, child_sitemaps, url_count, redirect_count, error_count, urls_checked, urls_total, error, created_at, finished_at';

type SnapshotRecord = {
  id: string;
  status: string;
  source_url: string;
  child_sitemaps: number;
  url_count: number;
  redirect_count: number;
  error_count: number;
  urls_checked: number;
  urls_total: number;
  error: string | null;
  created_at: string;
  finished_at: string | null;
};

export function toSnapshotSummary(row: SnapshotRecord): SnapshotSummary {
  return {
    id: row.id,
    status: row.status as SnapshotStatus,
    sourceUrl: row.source_url,
    childSitemaps: row.child_sitemaps,
    urlCount: row.url_count,
    redirectCount: row.redirect_count,
    errorCount: row.error_count,
    urlsChecked: row.urls_checked,
    urlsTotal: row.urls_total,
    error: row.error,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  };
}

/** Snapshots of a project, newest first. */
export async function listSnapshots(projectId: string, limit = 50): Promise<SnapshotSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('sitemap_snapshots')
    .select(SNAPSHOT_SELECT)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Could not load snapshots: ${error.message}`);
  return data.map(toSnapshotSummary);
}

/** A snapshot ran the redirect check when it recorded URLs to check. */
export function isChecked(snapshot: Pick<SnapshotSummary, 'urlsTotal'>): boolean {
  return snapshot.urlsTotal > 0;
}

export interface UrlPage {
  rows: SnapshotUrlRow[];
  total: number;
  counts: Record<SitemapFilter, number>;
}

/** One page of the URL table plus the count of every filter (same search applied). */
export async function getUrlPage(
  snapshot: SnapshotSummary,
  query: Pick<SitemapQuery, 'filter' | 'search' | 'page'>,
): Promise<UrlPage> {
  const supabase = await createClient();
  const checked = isChecked(snapshot);
  // Server-side equivalent of `matchesFilter`.
  const urls = (filter: SitemapFilter, head: boolean) => {
    let q = supabase
      .from('sitemap_urls')
      .select('id, url, kind, http_status, redirect_to, included, source', {
        count: 'exact',
        head,
      })
      .eq('snapshot_id', snapshot.id);
    if (query.search) q = q.ilike('url', `%${escapeLike(query.search)}%`);
    switch (filter) {
      case 'all':
        return q;
      case 'included':
        return q.eq('included', true);
      case 'excluded':
        return q.eq('included', false);
      case 'redirects':
        return q.or('redirect_to.not.is.null,and(http_status.gte.300,http_status.lt.400)');
      case 'errors':
        // The status ranges exclude 3xx, so only redirects with a target need excluding.
        return checked
          ? q.is('redirect_to', null).or('http_status.is.null,http_status.gte.400')
          : q.is('redirect_to', null).gte('http_status', 400);
      case 'files':
        return q.eq('kind', 'file');
    }
  };

  const from = (query.page - 1) * SITEMAP_PAGE_SIZE;
  const [page, ...countResults] = await Promise.all([
    urls(query.filter, false)
      .order('url')
      .range(from, from + SITEMAP_PAGE_SIZE - 1),
    ...SITEMAP_FILTERS.map((filter) => urls(filter, true)),
  ]);
  // Requesting a page past the end is not an error for the UI: it shows an empty page.
  if (page.error && page.error.code !== 'PGRST103') {
    throw new Error(`Could not load URLs: ${page.error.message}`);
  }
  const counts = {} as Record<SitemapFilter, number>;
  SITEMAP_FILTERS.forEach((filter, index) => {
    const result = countResults[index]!;
    if (result.error) throw new Error(`Could not count URLs: ${result.error.message}`);
    counts[filter] = result.count ?? 0;
  });
  return {
    rows: (page.data ?? []).map((row) => ({
      id: row.id,
      url: row.url,
      kind: row.kind,
      httpStatus: row.http_status,
      redirectTo: row.redirect_to,
      included: row.included,
      source: row.source,
    })),
    total: counts[query.filter],
    counts,
  };
}

/** Every URL row of a snapshot, fetched in chunks (PostgREST caps responses at 1000 rows). */
export async function fetchAllSnapshotUrls(
  supabase: UserClient,
  snapshotId: string,
): Promise<{ url: string; included: boolean }[]> {
  const rows: { url: string; included: boolean }[] = [];
  for (let from = 0; ; from += FETCH_CHUNK) {
    const { data, error } = await supabase
      .from('sitemap_urls')
      .select('url, included')
      .eq('snapshot_id', snapshotId)
      .order('url')
      .order('id')
      .range(from, from + FETCH_CHUNK - 1);
    if (error) throw new Error(`Could not load URLs: ${error.message}`);
    rows.push(...data);
    if (data.length < FETCH_CHUNK) return rows;
  }
}

export interface SnapshotDiff {
  previous: SnapshotSummary;
  added: string[];
  removed: string[];
}

/**
 * F-SITEMAP-3: URLs added / removed since the previous completed snapshot, or null when there is
 * none. Compares every URL of the snapshots (included or not).
 */
export async function diffWithPrevious(
  snapshot: SnapshotSummary,
  snapshots: readonly SnapshotSummary[],
): Promise<SnapshotDiff | null> {
  if (snapshot.status !== 'completed') return null;
  const previous = snapshots.find(
    (other) => other.status === 'completed' && other.createdAt < snapshot.createdAt,
  );
  if (!previous) return null;
  const supabase = await createClient();
  const [before, after] = await Promise.all([
    fetchAllSnapshotUrls(supabase, previous.id),
    fetchAllSnapshotUrls(supabase, snapshot.id),
  ]);
  return {
    previous,
    ...diffSnapshotUrls(
      before.map((row) => row.url),
      after.map((row) => row.url),
    ),
  };
}

export interface ManualUrlRow {
  id: string;
  url: string;
  note: string | null;
  createdAt: string;
}

export async function listManualUrls(projectId: string): Promise<ManualUrlRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('project_manual_urls')
    .select('id, url, note, created_at')
    .eq('project_id', projectId)
    .order('url');
  if (error) throw new Error(`Could not load manual URLs: ${error.message}`);
  return data.map((row) => ({
    id: row.id,
    url: row.url,
    note: row.note,
    createdAt: row.created_at,
  }));
}
