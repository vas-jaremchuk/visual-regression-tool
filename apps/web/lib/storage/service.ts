import 'server-only';
import type { ComparisonStatus, RunStatus } from '@vrt/shared';
import { audit } from '../audit';
import { assertCan, ForbiddenError } from '../auth/assert-can';
import type { CurrentUser } from '../auth/session';
import { RequestError } from '../members/errors';
import { createClient } from '../supabase/server';
import { workerClient } from '../worker-client';
import { createStorageCommands, type DeletePreview, type StorageGateway } from './commands';

type UserClient = Awaited<ReturnType<typeof createClient>>;

function check<T>(what: string, result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(`Could not ${what}: ${result.error.message}`);
  return result.data;
}

function count(what: string, result: { count: number | null; error: { message: string } | null }) {
  if (result.error) throw new Error(`Could not ${what}: ${result.error.message}`);
  return result.count ?? 0;
}

/** `StorageGateway` as the signed-in user: every read and write goes through RLS. */
function supabaseGateway(supabase: UserClient): StorageGateway {
  async function loadProjectRow(projectId: string) {
    return check(
      'load the project',
      await supabase
        .from('projects_public')
        .select('id, slug, baseline_run_id')
        .eq('id', projectId)
        .maybeSingle(),
    );
  }

  return {
    async loadRun(runId) {
      const run = check(
        'load the run',
        await supabase
          .from('runs')
          .select('id, project_id, label, status')
          .eq('id', runId)
          .maybeSingle(),
      );
      if (!run) return null;
      const project = await loadProjectRow(run.project_id);
      return {
        id: run.id,
        projectId: run.project_id,
        label: run.label,
        status: run.status as RunStatus,
        isBaseline: project?.baseline_run_id === run.id,
      };
    },

    async loadComparison(comparisonId) {
      const row = check(
        'load the comparison',
        await supabase
          .from('comparisons')
          .select('id, project_id, label, status')
          .eq('id', comparisonId)
          .maybeSingle(),
      );
      if (!row) return null;
      return {
        id: row.id,
        projectId: row.project_id,
        label: row.label,
        status: row.status as ComparisonStatus,
      };
    },

    async loadProject(projectId) {
      const row = await loadProjectRow(projectId);
      return row?.id ? { id: row.id, slug: row.slug! } : null;
    },

    async comparisonsOfRun(runId) {
      const rows = check(
        'load the comparisons of the run',
        await supabase
          .from('comparisons')
          .select('id, label, status')
          .or(`before_run_id.eq.${runId},after_run_id.eq.${runId}`)
          .order('label'),
      );
      return (rows ?? []).map((r) => ({
        id: r.id,
        label: r.label,
        status: r.status as ComparisonStatus,
      }));
    },

    async countObjects({ runId, comparisonIds }) {
      let total = 0;
      if (runId) {
        total += count(
          'count run objects',
          await supabase
            .from('run_items')
            .select('id', { count: 'exact', head: true })
            .eq('run_id', runId)
            .eq('status', 'done'),
        );
      }
      if (comparisonIds.length > 0) {
        total += count(
          'count diff images',
          await supabase
            .from('comparison_items')
            .select('id', { count: 'exact', head: true })
            .in('comparison_id', comparisonIds)
            .not('diff_key', 'is', null),
        );
        total += count(
          'count reports',
          await supabase
            .from('comparisons')
            .select('id', { count: 'exact', head: true })
            .in('id', comparisonIds)
            .not('report_r2_key', 'is', null),
        );
      }
      return total;
    },

    async setRunStatus(runId, status) {
      check('update the run', await supabase.from('runs').update({ status }).eq('id', runId));
    },

    async setComparisonStatus(ids, status) {
      if (ids.length === 0) return;
      check(
        'update the comparisons',
        await supabase.from('comparisons').update({ status }).in('id', ids),
      );
    },

    async archiveProject(projectId) {
      check(
        'archive the project',
        await supabase
          .from('projects')
          .update({ archived_at: new Date().toISOString() })
          .eq('id', projectId)
          .is('archived_at', null),
      );
    },

    async deleteProjectRow(projectId) {
      const { error } = await supabase.from('projects').delete().eq('id', projectId);
      if (error?.code === '42501') throw new RequestError(403, 'forbidden', error.message);
      if (error) throw new Error(`Could not delete the project: ${error.message}`);
    },

    audit: (action, projectId, details) => audit(supabase, action, projectId, details),
  };
}

async function commands(user: CurrentUser | null) {
  if (!user) throw new ForbiddenError('run.delete');
  const supabase = await createClient();
  return createStorageCommands({
    authorize: async (action, projectId) => {
      await assertCan(user, action, projectId);
    },
    db: supabaseGateway(supabase),
    worker: workerClient(),
  });
}

/** F-RUN-4, F-STORAGE-3: project admin previews or deletes a run and its comparisons. */
export async function deleteRun(
  user: CurrentUser | null,
  runId: string,
  confirm: boolean,
): Promise<DeletePreview> {
  return (await commands(user)).deleteRun(runId, confirm);
}

/** F-STORAGE-3: project admin previews or deletes a comparison. */
export async function deleteComparison(
  user: CurrentUser | null,
  comparisonId: string,
  confirm: boolean,
): Promise<DeletePreview> {
  return (await commands(user)).deleteComparison(comparisonId, confirm);
}

/** F-STORAGE-1: project admin recomputes the cached storage usage. */
export async function refreshStorage(
  user: CurrentUser | null,
  projectId: string,
): Promise<{ workflowId: string }> {
  return (await commands(user)).refreshStorage(projectId);
}

/** F-PROJ-6: platform admin deletes a project, optionally with its R2 objects. */
export async function deleteProject(
  user: CurrentUser | null,
  projectId: string,
  input: { confirmSlug: string; deleteObjects: boolean },
): Promise<{ queued: boolean }> {
  return (await commands(user)).deleteProject(projectId, input);
}
