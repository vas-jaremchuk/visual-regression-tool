import type { SupabaseClient } from '@supabase/supabase-js';
import type { Json } from '@vrt/db';
import type { ReportItem } from '@vrt/engine';
import type { ComparisonStatus, ReviewStatus, RunStatus } from '@vrt/shared';
import type {
  ChangedItem,
  CompareRunItem,
  CompareSettings,
  CompareStore,
  ItemCounts,
  PendingPair,
  ReviewCounts,
} from './compare-job';
import type { DiffRepo } from './diff-consumer';

/** `CompareStore` and `DiffRepo` over the service-role Supabase client (RLS bypassed; worker only). */

const PAGE = 1000;
const INSERT_CHUNK = 500;

function check<T>(what: string, result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(`Could not ${what}: ${result.error.message}`);
  return result.data;
}

const EMPTY_COUNTS: ItemCounts = {
  compared: 0,
  changed: 0,
  unchanged: 0,
  new: 0,
  missing: 0,
  redirect: 0,
  error: 0,
  files_changed: 0,
  files_total: 0,
};

const EMPTY_REVIEW: ReviewCounts = { pending: 0, approved: 0, rejected: 0, ignored: 0 };

async function pages<T>(
  what: string,
  query: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = check(what, await query(offset, offset + PAGE - 1)) ?? [];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

export function supabaseCompareStore(db: SupabaseClient): CompareStore {
  return {
    async loadComparison(comparisonId) {
      const row = check(
        'load the comparison',
        await db
          .from('comparisons')
          .select('id, project_id, label, status, before_run_id, after_run_id, started_at')
          .eq('id', comparisonId)
          .maybeSingle(),
      );
      if (!row) return null;
      return {
        id: row.id,
        projectId: row.project_id,
        label: row.label,
        status: row.status as ComparisonStatus,
        beforeRunId: row.before_run_id,
        afterRunId: row.after_run_id,
        startedAt: row.started_at,
      };
    },

    async loadRun(runId) {
      const row = check(
        'load the run',
        await db
          .from('runs')
          .select('id, project_id, label, status, is_legacy, viewport_slugs')
          .eq('id', runId)
          .maybeSingle(),
      );
      if (!row) return null;
      return {
        id: row.id,
        projectId: row.project_id,
        label: row.label,
        status: row.status as RunStatus,
        isLegacy: row.is_legacy,
        viewportSlugs: row.viewport_slugs ?? [],
      };
    },

    async loadProject(projectId) {
      const row = check(
        'load the project',
        await db
          .from('projects')
          .select(
            'id, name, r2_bucket, r2_public_url, check_redirects, diff_threshold, ' +
              'change_threshold_pct, max_page_height, basic_auth_user, basic_auth_pass_enc',
          )
          .eq('id', projectId)
          .maybeSingle(),
      ) as Record<string, unknown> | null;
      if (!row) throw new Error(`Project ${projectId} not found`);
      return {
        id: row.id as string,
        name: row.name as string,
        bucket: row.r2_bucket as string,
        publicUrl: (row.r2_public_url as string | null) || null,
        checkRedirects: row.check_redirects as boolean,
        diffThreshold: Number(row.diff_threshold),
        changeThresholdPct: Number(row.change_threshold_pct),
        maxPageHeight: row.max_page_height as number,
        basicAuthUser: (row.basic_auth_user as string | null) ?? null,
        basicAuthPassEnc: (row.basic_auth_pass_enc as string | null) ?? null,
      };
    },

    async loadIgnoreRules(projectId) {
      const rows = check(
        'load ignore rules',
        await db
          .from('ignore_rules')
          .select('type, url_pattern, selector, region, viewport_slug, applies_to, enabled')
          .eq('project_id', projectId)
          .eq('enabled', true)
          .in('applies_to', ['compare', 'both']),
      );
      return rows ?? [];
    },

    async loadSettings(comparisonId) {
      const row = check(
        'load the comparison settings',
        await db.from('comparisons').select('settings').eq('id', comparisonId).single(),
      );
      return row!.settings as CompareSettings;
    },

    async updateComparison(comparisonId, patch) {
      check(
        'update the comparison',
        await db
          .from('comparisons')
          .update(patch as Record<string, Json>)
          .eq('id', comparisonId),
      );
    },

    async listRunItems(runId) {
      return pages<CompareRunItem>('list run items', (from, to) =>
        db
          .from('run_items')
          .select(
            'url, kind, viewport_slug, filename, status, r2_key, sha256, bytes, http_status, ' +
              'content_type, last_modified, etag, final_url, error',
          )
          .eq('run_id', runId)
          .order('id')
          .range(from, to)
          .overrideTypes<CompareRunItem[], { merge: false }>(),
      );
    },

    async deleteItems(comparisonId) {
      check(
        'delete comparison items',
        await db.from('comparison_items').delete().eq('comparison_id', comparisonId),
      );
    },

    async insertItems(items) {
      for (let i = 0; i < items.length; i += INSERT_CHUNK) {
        check(
          'create comparison items',
          await db.from('comparison_items').insert(items.slice(i, i + INSERT_CHUNK)),
        );
      }
    },

    async listPendingPairs(comparisonId) {
      return pages<PendingPair>('list pending pairs', (from, to) =>
        db
          .from('comparison_items')
          .select('id, url')
          .eq('comparison_id', comparisonId)
          .eq('kind', 'page')
          .eq('status', 'pending')
          .order('url')
          .order('id')
          .range(from, to),
      );
    },

    async markRedirect(comparisonId, url, to) {
      check(
        'mark redirects',
        await db
          .from('comparison_items')
          .update({ status: 'redirect', redirect_to: to })
          .eq('comparison_id', comparisonId)
          .eq('url', url)
          .eq('status', 'pending'),
      );
    },

    async failPending(comparisonId, error) {
      check(
        'fail pending items',
        await db
          .from('comparison_items')
          .update({ status: 'error', error })
          .eq('comparison_id', comparisonId)
          .eq('status', 'pending'),
      );
    },

    async listUnreviewedChanged(comparisonId) {
      const rows = await pages<{
        id: string;
        url: string | null;
        viewport_slug: string | null;
        after_key: string | null;
      }>('list changed items', (from, to) =>
        db
          .from('comparison_items')
          .select('id, url, viewport_slug, after_key')
          .eq('comparison_id', comparisonId)
          .eq('status', 'changed')
          .eq('review', 'pending')
          .order('id')
          .range(from, to),
      );
      return rows.map((r): ChangedItem => ({
        id: r.id,
        url: r.url,
        viewportSlug: r.viewport_slug,
        afterKey: r.after_key,
      }));
    },

    async findReviewMemory(projectId, url, viewportSlug, afterSha256) {
      let query = db
        .from('review_memory')
        .select('review, comparison_label')
        .eq('project_id', projectId)
        .eq('url', url)
        .eq('after_sha256', afterSha256);
      query = viewportSlug
        ? query.eq('viewport_slug', viewportSlug)
        : query.is('viewport_slug', null);
      const rows = check('load review memory', await query.limit(1));
      const row = (rows ?? [])[0];
      return row
        ? { review: row.review as ReviewStatus, comparisonLabel: row.comparison_label }
        : null;
    },

    async setReview(itemIds, review, note) {
      check(
        'set the review',
        await db
          .from('comparison_items')
          .update({ review, review_note: note, reviewed_at: new Date().toISOString() })
          .in('id', itemIds),
      );
    },

    async listReportItems(comparisonId) {
      return pages<ReportItem>('list report items', (from, to) =>
        db
          .from('comparison_items')
          .select(
            'url, name, kind, viewport_slug, status, diff_pct, diff_pixels, total_pixels, ' +
              'before_key, after_key, diff_key, redirect_to, fp_before, fp_after, review, error',
          )
          .eq('comparison_id', comparisonId)
          .order('id')
          .range(from, to)
          .overrideTypes<ReportItem[], { merge: false }>(),
      );
    },

    async refreshCounts(comparisonId) {
      check(
        'refresh comparison counts',
        await db.rpc('refresh_comparison_counts', { p_id: comparisonId }),
      );
    },

    async loadCounts(comparisonId) {
      const row = check(
        'load comparison counts',
        await db
          .from('comparisons')
          .select('counts, review_counts')
          .eq('id', comparisonId)
          .single(),
      );
      return {
        counts: { ...EMPTY_COUNTS, ...(row!.counts as Partial<ItemCounts>) },
        review: { ...EMPTY_REVIEW, ...(row!.review_counts as Partial<ReviewCounts>) },
      };
    },

    async audit(action, projectId, details) {
      check(
        'write the audit log',
        await db
          .from('audit_log')
          .insert({ action, project_id: projectId, actor_id: null, details: details as Json }),
      );
    },
  };
}

export function supabaseDiffRepo(db: SupabaseClient): DiffRepo {
  return {
    async getComparison(comparisonId) {
      const row = check(
        'load the comparison',
        await db
          .from('comparisons')
          .select('id, project_id, status, settings, projects!inner(r2_bucket)')
          .eq('id', comparisonId)
          .maybeSingle(),
      ) as Record<string, unknown> | null;
      if (!row) return null;
      const project = row.projects as { r2_bucket: string } | { r2_bucket: string }[];
      return {
        id: row.id as string,
        projectId: row.project_id as string,
        status: row.status as string,
        bucket: (Array.isArray(project) ? project[0]! : project).r2_bucket,
        settings: row.settings as CompareSettings,
      };
    },

    async getItems(comparisonId, itemIds) {
      const rows = check(
        'load comparison items',
        await db
          .from('comparison_items')
          .select('id, url, viewport_slug, status, before_key, after_key, diff_key')
          .eq('comparison_id', comparisonId)
          .in('id', itemIds),
      );
      return (rows ?? []).map((r) => ({
        id: r.id,
        url: r.url,
        viewportSlug: r.viewport_slug,
        status: r.status,
        beforeKey: r.before_key,
        afterKey: r.after_key,
        diffKey: r.diff_key,
      }));
    },

    async update(itemId, result) {
      check(
        'update the comparison item',
        await db.from('comparison_items').update(result).eq('id', itemId).eq('status', 'pending'),
      );
    },

    async refreshCounts(comparisonId) {
      check(
        'refresh comparison counts',
        await db.rpc('refresh_comparison_counts', { p_id: comparisonId }),
      );
    },
  };
}
