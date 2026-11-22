import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@vrt/db';
import type { CmpItemStatus, ComparisonStatus } from '@vrt/shared';
import { createClient } from '../supabase/server';
import { viewportTabs, type ReportCounts, type ReviewCounts } from './report';
import { REPORT_ITEM_COLUMNS, toReportItem, type ReportItem } from './report-items';

/**
 * Report page data (F-CMP-2, F-CMP-5, F-CMP-6) as the signed-in user sees it (RLS). The share page
 * passes the service-role client instead; every query here is filtered by the comparison id.
 */

type ReportClient = SupabaseClient<Database>;

/** Rows per section below the list (files, redirected, new, missing). */
export const SECTION_LIMIT = 500;

export interface ReportHeader {
  id: string;
  label: string;
  status: ComparisonStatus;
  beforeRunId: string;
  afterRunId: string;
  beforeLabel: string;
  afterLabel: string;
  counts: ReportCounts;
  reviewCounts: Partial<ReviewCounts>;
  /** `changeThresholdPct` frozen when the comparison started, for the empty state wording. */
  changeThresholdPct: number | null;
  viewports: string[];
  createdAt: string;
  finishedAt: string | null;
  /** The public share link (04 §5); the token itself is never stored. */
  share: { active: boolean; expiresAt: string | null };
}

export interface Fingerprint {
  sha256: string | null;
  size: number | null;
}

export interface FileItem {
  id: string;
  url: string | null;
  name: string;
  status: CmpItemStatus;
  before: Fingerprint | null;
  after: Fingerprint | null;
}

export interface PageListItem {
  id: string;
  url: string | null;
  name: string;
  viewportSlug: string | null;
  redirectTo: string | null;
}

export interface ReportSectionsData {
  files: FileItem[];
  redirected: PageListItem[];
  added: PageListItem[];
  missing: PageListItem[];
}

type Labels = { label: string } | { label: string }[] | null;

function labelOf(value: Labels): string {
  return (Array.isArray(value) ? value[0]?.label : value?.label) ?? '';
}

function fingerprint(value: unknown): Fingerprint | null {
  if (!value || typeof value !== 'object') return null;
  const fp = value as Record<string, unknown>;
  return {
    sha256: typeof fp.sha256 === 'string' ? fp.sha256 : null,
    size: typeof fp.size === 'number' ? fp.size : null,
  };
}

function shareState(hash: string | null, expiresAt: string | null): ReportHeader['share'] {
  const live = hash !== null && (expiresAt === null || new Date(expiresAt).getTime() > Date.now());
  return { active: live, expiresAt: live ? expiresAt : null };
}

export async function getReportHeader(
  projectId: string,
  comparisonId: string,
  client?: ReportClient,
): Promise<ReportHeader | null> {
  const supabase = client ?? (await createClient());
  const { data, error } = await supabase
    .from('comparisons')
    .select(
      'id, label, status, settings, counts, review_counts, created_at, finished_at, ' +
        'share_token_hash, share_expires_at, before_run_id, after_run_id, ' +
        'before:runs!comparisons_project_id_before_run_id_fkey(label), ' +
        'after:runs!comparisons_project_id_after_run_id_fkey(label)',
    )
    .eq('project_id', projectId)
    .eq('id', comparisonId)
    .maybeSingle();
  if (error) throw new Error(`Could not load the comparison: ${error.message}`);
  if (!data) return null;
  const row = data as unknown as Record<string, unknown>;
  const settings = (row.settings ?? {}) as Record<string, unknown>;
  const counts = (row.counts ?? {}) as ReportCounts;
  return {
    id: row.id as string,
    label: row.label as string,
    status: row.status as ComparisonStatus,
    beforeRunId: row.before_run_id as string,
    afterRunId: row.after_run_id as string,
    beforeLabel: labelOf(row.before as Labels),
    afterLabel: labelOf(row.after as Labels),
    counts,
    reviewCounts: (row.review_counts ?? {}) as Partial<ReviewCounts>,
    changeThresholdPct:
      typeof settings.changeThresholdPct === 'number' ? settings.changeThresholdPct : null,
    viewports: viewportTabs(settings.viewports, counts),
    createdAt: row.created_at as string,
    finishedAt: (row.finished_at as string | null) ?? null,
    share: shareState(
      (row.share_token_hash as string | null) ?? null,
      (row.share_expires_at as string | null) ?? null,
    ),
  };
}

/** One page item of the comparison, for the deep-linked item viewer. */
export async function getReportItem(
  comparisonId: string,
  itemId: string,
  client?: ReportClient,
): Promise<ReportItem | null> {
  const supabase = client ?? (await createClient());
  const { data, error } = await supabase
    .from('comparison_items')
    .select(REPORT_ITEM_COLUMNS)
    .eq('comparison_id', comparisonId)
    .eq('id', itemId)
    .eq('kind', 'page')
    .maybeSingle();
  if (error) throw new Error(`Could not load the item: ${error.message}`);
  return data ? toReportItem(data as unknown as Parameters<typeof toReportItem>[0]) : null;
}

export async function getReportSections(
  comparisonId: string,
  client?: ReportClient,
): Promise<ReportSectionsData> {
  const supabase = client ?? (await createClient());
  const pages = (status: CmpItemStatus) =>
    supabase
      .from('comparison_items')
      .select('id, url, name, viewport_slug, redirect_to')
      .eq('comparison_id', comparisonId)
      .eq('kind', 'page')
      .eq('status', status)
      .order('url')
      .order('viewport_slug')
      .limit(SECTION_LIMIT);
  const [files, redirected, added, missing] = await Promise.all([
    supabase
      .from('comparison_items')
      .select('id, url, name, status, fp_before, fp_after')
      .eq('comparison_id', comparisonId)
      .eq('kind', 'file')
      .order('url')
      .limit(SECTION_LIMIT),
    pages('redirect'),
    pages('new'),
    pages('missing'),
  ]);
  for (const result of [files, redirected, added, missing]) {
    if (result.error) throw new Error(`Could not load the report: ${result.error.message}`);
  }
  const toPage = (r: {
    id: string;
    url: string | null;
    name: string;
    viewport_slug: string | null;
    redirect_to: string | null;
  }): PageListItem => ({
    id: r.id,
    url: r.url,
    name: r.name,
    viewportSlug: r.viewport_slug,
    redirectTo: r.redirect_to,
  });
  return {
    files: (files.data ?? []).map((r) => ({
      id: r.id,
      url: r.url,
      name: r.name,
      status: r.status,
      before: fingerprint(r.fp_before),
      after: fingerprint(r.fp_after),
    })),
    redirected: (redirected.data ?? []).map(toPage),
    added: (added.data ?? []).map(toPage),
    missing: (missing.data ?? []).map(toPage),
  };
}
