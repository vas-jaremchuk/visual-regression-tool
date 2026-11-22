import type { SupabaseClient } from '@supabase/supabase-js';
import type { Json } from '@vrt/db';
import type { StorageGroupUsage } from '@vrt/shared';
import type { StorageStore } from '../storage/storage-job';
import type { DeleteStore } from './delete-job';

/** `DeleteStore` and `StorageStore` over the service-role Supabase client (worker only). */

const PAGE = 1000;

function check<T>(what: string, result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(`Could not ${what}: ${result.error.message}`);
  return result.data;
}

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

async function loadBucket(db: SupabaseClient, projectId: string) {
  return check(
    'load the project',
    await db
      .from('projects')
      .select('id, r2_bucket, baseline_run_id')
      .eq('id', projectId)
      .maybeSingle(),
  ) as { id: string; r2_bucket: string; baseline_run_id: string | null } | null;
}

export function supabaseDeleteStore(db: SupabaseClient): DeleteStore {
  return {
    async loadRun(runId) {
      const run = check(
        'load the run',
        await db.from('runs').select('id, project_id, label').eq('id', runId).maybeSingle(),
      ) as { id: string; project_id: string; label: string } | null;
      if (!run) return null;
      const project = await loadBucket(db, run.project_id);
      if (!project) return null;
      return {
        id: run.id,
        projectId: run.project_id,
        label: run.label,
        bucket: project.r2_bucket,
        isBaseline: project.baseline_run_id === run.id,
      };
    },

    async loadComparison(comparisonId) {
      const row = check(
        'load the comparison',
        await db
          .from('comparisons')
          .select('id, project_id, label')
          .eq('id', comparisonId)
          .maybeSingle(),
      ) as { id: string; project_id: string; label: string } | null;
      if (!row) return null;
      const project = await loadBucket(db, row.project_id);
      if (!project) return null;
      return { id: row.id, projectId: row.project_id, label: row.label, bucket: project.r2_bucket };
    },

    async loadProject(projectId) {
      const project = await loadBucket(db, projectId);
      return project ? { id: project.id, bucket: project.r2_bucket } : null;
    },

    async comparisonsOfRun(runId) {
      return pages<{ id: string; label: string }>('load the comparisons of the run', (from, to) =>
        db
          .from('comparisons')
          .select('id, label')
          .or(`before_run_id.eq.${runId},after_run_id.eq.${runId}`)
          .order('id')
          .range(from, to),
      );
    },

    async runsOfProject(projectId) {
      return pages<{ id: string; label: string }>('load the runs of the project', (from, to) =>
        db.from('runs').select('id, label').eq('project_id', projectId).order('id').range(from, to),
      );
    },

    async comparisonsOfProject(projectId) {
      return pages<{ id: string; label: string }>(
        'load the comparisons of the project',
        (from, to) =>
          db
            .from('comparisons')
            .select('id, label')
            .eq('project_id', projectId)
            .order('id')
            .range(from, to),
      );
    },

    async setRunStatus(runId, status) {
      check('update the run', await db.from('runs').update({ status }).eq('id', runId));
    },

    async setComparisonStatus(comparisonIds, status) {
      if (comparisonIds.length === 0) return;
      check(
        'update the comparisons',
        await db.from('comparisons').update({ status }).in('id', comparisonIds),
      );
    },

    async deleteComparisons(comparisonIds) {
      if (comparisonIds.length === 0) return;
      check(
        'delete the comparisons',
        await db.from('comparisons').delete().in('id', comparisonIds),
      );
    },

    async deleteRun(runId) {
      check('delete the run', await db.from('runs').delete().eq('id', runId));
    },

    async deleteProject(projectId) {
      check('delete the project', await db.from('projects').delete().eq('id', projectId));
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

export function supabaseStorageStore(db: SupabaseClient): StorageStore {
  return {
    async loadProject(projectId) {
      const project = await loadBucket(db, projectId);
      return project ? { id: project.id, bucket: project.r2_bucket } : null;
    },

    async markRunning(projectId, bucket, workflowId) {
      check(
        'mark the storage refresh running',
        await db.from('storage_usage').upsert({
          project_id: projectId,
          bucket,
          status: 'running',
          error: null,
          workflow_id: workflowId,
          updated_at: new Date().toISOString(),
        }),
      );
    },

    async saveUsage(projectId, usage, refreshedAt) {
      check(
        'save the storage usage',
        await db
          .from('storage_usage')
          .update({
            status: 'completed',
            total_bytes: usage.totalBytes,
            object_count: usage.objectCount,
            groups: usage.groups satisfies StorageGroupUsage[] as unknown as Json,
            error: null,
            refreshed_at: refreshedAt,
            updated_at: refreshedAt,
          })
          .eq('project_id', projectId),
      );
    },

    async markFailed(projectId, error) {
      check(
        'mark the storage refresh failed',
        await db
          .from('storage_usage')
          .update({ status: 'failed', error, updated_at: new Date().toISOString() })
          .eq('project_id', projectId),
      );
    },
  };
}
