import type { Json } from '@vrt/db';
import type { ComparisonStatus, DeleteJob, PermissionAction, RunStatus } from '@vrt/shared';
import { RequestError } from '../members/errors';

/**
 * Storage and delete commands (F-STORAGE-1/3/4, F-RUN-4, F-PROJ-6). Pure orchestration over
 * `StorageGateway`, so the rules (baseline is kept, active jobs are not deleted, preview before
 * confirm) are tested without a database; `service.ts` wires it to Supabase and the worker.
 */

export interface DeletableRun {
  id: string;
  projectId: string;
  label: string;
  status: RunStatus;
  isBaseline: boolean;
}

export interface DeletableComparison {
  id: string;
  projectId: string;
  label: string;
  status: ComparisonStatus;
}

export interface StorageGateway {
  loadRun(runId: string): Promise<DeletableRun | null>;
  loadComparison(comparisonId: string): Promise<DeletableComparison | null>;
  loadProject(projectId: string): Promise<{ id: string; slug: string } | null>;
  /** Comparisons whose before or after run is `runId`. */
  comparisonsOfRun(
    runId: string,
  ): Promise<{ id: string; label: string; status: ComparisonStatus }[]>;
  /** Estimated R2 objects: stored run items, diff images and reports. */
  countObjects(input: { runId: string | null; comparisonIds: string[] }): Promise<number>;
  setRunStatus(runId: string, status: RunStatus): Promise<void>;
  setComparisonStatus(ids: string[], status: ComparisonStatus): Promise<void>;
  archiveProject(projectId: string): Promise<void>;
  deleteProjectRow(projectId: string): Promise<void>;
  audit(action: string, projectId: string, details: Record<string, Json>): Promise<void>;
}

export interface StorageWorker {
  startDelete(input: DeleteJob): Promise<{ workflowId: string }>;
  startStorage(input: { projectId: string }): Promise<{ workflowId: string }>;
}

export interface StorageCommandDeps {
  /** Throws unless the user may do `action` in the project (`assertCan`). */
  authorize(action: PermissionAction, projectId: string | null): Promise<void>;
  db: StorageGateway;
  worker: StorageWorker;
  log?: (error: unknown) => void;
}

export interface DeletePreview {
  deleting: { comparisons: { id: string; label: string }[]; objects: number };
}

/** Runs / comparisons whose job is still writing objects. */
const ACTIVE: readonly string[] = ['queued', 'running', 'deleting'];

function workerUnavailable(): RequestError {
  return new RequestError(502, 'worker_unavailable', 'Could not start the delete job. Try again.');
}

export function createStorageCommands(deps: StorageCommandDeps) {
  const { db, worker } = deps;
  const log = deps.log ?? console.error;

  return {
    /**
     * DELETE /api/runs/:id (F-RUN-4, F-STORAGE-3): without `confirm` lists what would go (the
     * comparisons that use the run and the object count); with it starts the DeleteWorkflow.
     * A run in `delete_failed` can be deleted again (retry).
     */
    async deleteRun(runId: string, confirm: boolean): Promise<DeletePreview> {
      const run = await db.loadRun(runId);
      if (!run) throw new RequestError(404, 'not_found', 'Run not found');
      await deps.authorize('run.delete', run.projectId);
      if (run.isBaseline) {
        throw new RequestError(
          422,
          'business_rule',
          `Run ${run.label} is the baseline; set another baseline before deleting it`,
        );
      }
      if (ACTIVE.includes(run.status)) {
        throw new RequestError(409, 'conflict', `Run ${run.label} is ${run.status}`);
      }
      const comparisons = await db.comparisonsOfRun(runId);
      const busy = comparisons.find((c) => ACTIVE.includes(c.status));
      if (busy) {
        throw new RequestError(409, 'conflict', `Comparison ${busy.label} is ${busy.status}`);
      }
      const preview: DeletePreview = {
        deleting: {
          comparisons: comparisons.map(({ id, label }) => ({ id, label })),
          objects: await db.countObjects({ runId, comparisonIds: comparisons.map((c) => c.id) }),
        },
      };
      if (!confirm) return preview;

      const ids = comparisons.map((c) => c.id);
      await db.setRunStatus(runId, 'deleting');
      await db.setComparisonStatus(ids, 'deleting');
      try {
        await worker.startDelete({ entity: 'run', id: runId });
      } catch (error) {
        log(error);
        await db.setRunStatus(runId, 'delete_failed');
        await db.setComparisonStatus(ids, 'delete_failed');
        throw workerUnavailable();
      }
      await db.audit('run.delete', run.projectId, {
        runId,
        label: run.label,
        comparisons: comparisons.map((c) => c.label),
        objects: preview.deleting.objects,
      });
      return preview;
    },

    /** DELETE /api/comparisons/:id (F-STORAGE-3): diffs, report and rows of one comparison. */
    async deleteComparison(comparisonId: string, confirm: boolean): Promise<DeletePreview> {
      const comparison = await db.loadComparison(comparisonId);
      if (!comparison) throw new RequestError(404, 'not_found', 'Comparison not found');
      await deps.authorize('run.delete', comparison.projectId);
      if (ACTIVE.includes(comparison.status)) {
        throw new RequestError(
          409,
          'conflict',
          `Comparison ${comparison.label} is ${comparison.status}`,
        );
      }
      const preview: DeletePreview = {
        deleting: {
          comparisons: [{ id: comparison.id, label: comparison.label }],
          objects: await db.countObjects({ runId: null, comparisonIds: [comparisonId] }),
        },
      };
      if (!confirm) return preview;

      await db.setComparisonStatus([comparisonId], 'deleting');
      try {
        await worker.startDelete({ entity: 'comparison', id: comparisonId });
      } catch (error) {
        log(error);
        await db.setComparisonStatus([comparisonId], 'delete_failed');
        throw workerUnavailable();
      }
      await db.audit('comparison.delete', comparison.projectId, {
        comparisonId,
        label: comparison.label,
        objects: preview.deleting.objects,
      });
      return preview;
    },

    /** POST /api/projects/:id/storage/refresh (F-STORAGE-1): project admin. */
    async refreshStorage(projectId: string): Promise<{ workflowId: string }> {
      await deps.authorize('project.settings', projectId);
      const project = await db.loadProject(projectId);
      if (!project) throw new RequestError(404, 'not_found', 'Project not found');
      let started: { workflowId: string };
      try {
        started = await worker.startStorage({ projectId });
      } catch (error) {
        log(error);
        throw new RequestError(
          502,
          'worker_unavailable',
          'Could not start the storage refresh. Try again.',
        );
      }
      await db.audit('storage.refresh', projectId, { workflowId: started.workflowId });
      return started;
    },

    /**
     * F-PROJ-6: platform admins delete a project after typing its slug. Without `deleteObjects`
     * the row goes now and R2 is untouched; with it the project is archived and the
     * DeleteWorkflow removes its objects, then the row. Deleting again retries a failed cleanup.
     */
    async deleteProject(
      projectId: string,
      input: { confirmSlug: string; deleteObjects: boolean },
    ): Promise<{ queued: boolean }> {
      await deps.authorize('project.archive', projectId);
      const project = await db.loadProject(projectId);
      if (!project) throw new RequestError(404, 'not_found', 'Project not found');
      if (input.confirmSlug !== project.slug) {
        throw new RequestError(400, 'validation', 'Type the project slug to confirm');
      }
      if (!input.deleteObjects) {
        await db.audit('project.delete', projectId, { slug: project.slug, deleteObjects: false });
        await db.deleteProjectRow(projectId);
        return { queued: false };
      }
      await db.archiveProject(projectId);
      try {
        await worker.startDelete({ entity: 'project', id: projectId });
      } catch (error) {
        log(error);
        throw workerUnavailable();
      }
      await db.audit('project.delete', projectId, { slug: project.slug, deleteObjects: true });
      return { queued: true };
    },
  };
}
