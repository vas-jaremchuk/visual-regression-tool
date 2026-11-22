import type { Json } from '@vrt/db';
import {
  diffPrefix,
  reportPrefix,
  runPrefix,
  type ComparisonStatus,
  type DeleteJob,
  type ObjectStore,
  type RunStatus,
} from '@vrt/shared';

/**
 * `DeleteWorkflow(entity, id)` steps (06 §1, F-STORAGE-3, F-RUN-4): delete the R2 objects of a
 * run (with the comparisons that use it), a comparison, or a project, then the DB rows. Rows are
 * removed only after R2 succeeded; a failure marks the run / comparisons `delete_failed`, and a
 * later request retries from the start (R2 deletes of missing keys are no-ops).
 */

export interface DeleteRun {
  id: string;
  projectId: string;
  label: string;
  bucket: string;
  isBaseline: boolean;
}

export interface DeleteComparison {
  id: string;
  projectId: string;
  label: string;
  bucket: string;
}

export interface DeleteProject {
  id: string;
  bucket: string;
}

export interface DeleteStore {
  loadRun(runId: string): Promise<DeleteRun | null>;
  loadComparison(comparisonId: string): Promise<DeleteComparison | null>;
  loadProject(projectId: string): Promise<DeleteProject | null>;
  /** Comparisons whose before or after run is `runId`. */
  comparisonsOfRun(runId: string): Promise<{ id: string; label: string }[]>;
  runsOfProject(projectId: string): Promise<{ id: string; label: string }[]>;
  comparisonsOfProject(projectId: string): Promise<{ id: string; label: string }[]>;
  setRunStatus(runId: string, status: RunStatus): Promise<void>;
  setComparisonStatus(comparisonIds: string[], status: ComparisonStatus): Promise<void>;
  deleteComparisons(comparisonIds: string[]): Promise<void>;
  deleteRun(runId: string): Promise<void>;
  deleteProject(projectId: string): Promise<void>;
  audit(action: string, projectId: string, details: Record<string, Json>): Promise<void>;
}

export interface DeleteJobDeps {
  store: DeleteStore;
  objects: Pick<ObjectStore, 'list' | 'delete'>;
}

/** Serialisable output of `plan()`, the input of the later steps. */
export interface DeletePlan {
  skip: boolean;
  projectId: string;
  bucket: string;
  /** R2 prefixes whose every object is deleted. */
  prefixes: string[];
  runId: string | null;
  comparisonIds: string[];
  label: string | null;
}

/** Thrown when the run is the project baseline (F-RUN-4); not worth retrying. */
export class BaselineRunError extends Error {
  constructor(label: string) {
    super(`Run ${label} is the project baseline; set another baseline first`);
    this.name = 'BaselineRunError';
  }
}

/** Keys per `ObjectStore.delete` call; the R2 store splits into S3 batches itself. */
const DELETE_CHUNK = 1000;

function comparisonPrefixes(labels: string[]): string[] {
  return labels.flatMap((label) => [diffPrefix(label), reportPrefix(label)]);
}

function messageOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 1_000);
}

export function createDeleteJob({ entity, id }: DeleteJob, { store, objects }: DeleteJobDeps) {
  const skip = (): DeletePlan => ({
    skip: true,
    projectId: '',
    bucket: '',
    prefixes: [],
    runId: null,
    comparisonIds: [],
    label: null,
  });

  return {
    /** Loads the entity, lists what goes and marks the run / comparisons `deleting`. */
    async plan(): Promise<DeletePlan> {
      if (entity === 'run') {
        const run = await store.loadRun(id);
        if (!run) return skip();
        if (run.isBaseline) throw new BaselineRunError(run.label);
        const comparisons = await store.comparisonsOfRun(id);
        await store.setRunStatus(id, 'deleting');
        await store.setComparisonStatus(
          comparisons.map((c) => c.id),
          'deleting',
        );
        return {
          skip: false,
          projectId: run.projectId,
          bucket: run.bucket,
          prefixes: [runPrefix(run.label), ...comparisonPrefixes(comparisons.map((c) => c.label))],
          runId: id,
          comparisonIds: comparisons.map((c) => c.id),
          label: run.label,
        };
      }
      if (entity === 'comparison') {
        const comparison = await store.loadComparison(id);
        if (!comparison) return skip();
        await store.setComparisonStatus([id], 'deleting');
        return {
          skip: false,
          projectId: comparison.projectId,
          bucket: comparison.bucket,
          prefixes: comparisonPrefixes([comparison.label]),
          runId: null,
          comparisonIds: [id],
          label: comparison.label,
        };
      }
      const project = await store.loadProject(id);
      if (!project) return skip();
      const [runs, comparisons] = await Promise.all([
        store.runsOfProject(id),
        store.comparisonsOfProject(id),
      ]);
      return {
        skip: false,
        projectId: id,
        bucket: project.bucket,
        prefixes: [
          ...runs.map((r) => runPrefix(r.label)),
          ...comparisonPrefixes(comparisons.map((c) => c.label)),
        ],
        runId: null,
        comparisonIds: comparisons.map((c) => c.id),
        label: null,
      };
    },

    /** Batch-deletes every object under the plan's prefixes; returns how many were deleted. */
    async deleteObjects(plan: DeletePlan): Promise<{ objects: number }> {
      let deleted = 0;
      for (const prefix of plan.prefixes) {
        let keys: string[] = [];
        for await (const { key } of objects.list(plan.bucket, prefix)) {
          keys.push(key);
          if (keys.length >= DELETE_CHUNK) {
            await objects.delete(plan.bucket, keys);
            deleted += keys.length;
            keys = [];
          }
        }
        if (keys.length > 0) {
          await objects.delete(plan.bucket, keys);
          deleted += keys.length;
        }
      }
      return { objects: deleted };
    },

    /** Removes the DB rows once R2 is clean; items cascade. */
    async deleteRows(plan: DeletePlan, objectCount: number): Promise<void> {
      if (entity === 'project') {
        await store.deleteProject(id);
        await store.audit('project.deleted', id, { projectId: id, objects: objectCount });
        return;
      }
      await store.deleteComparisons(plan.comparisonIds);
      if (plan.runId) await store.deleteRun(plan.runId);
      await store.audit(`${entity}.deleted`, plan.projectId, {
        [`${entity}Id`]: id,
        label: plan.label,
        comparisons: plan.comparisonIds,
        objects: objectCount,
      });
    },

    /** Keeps the rows with status `delete_failed` so the delete can be retried. */
    async fail(error: unknown): Promise<void> {
      const reason = messageOf(error);
      if (entity === 'run') {
        const run = await store.loadRun(id);
        if (!run) return;
        if (!(error instanceof BaselineRunError)) {
          await store.setRunStatus(id, 'delete_failed');
          await store.setComparisonStatus(
            (await store.comparisonsOfRun(id)).map((c) => c.id),
            'delete_failed',
          );
        }
        await store.audit('run.delete_failed', run.projectId, { runId: id, error: reason });
        return;
      }
      if (entity === 'comparison') {
        const comparison = await store.loadComparison(id);
        if (!comparison) return;
        await store.setComparisonStatus([id], 'delete_failed');
        await store.audit('comparison.delete_failed', comparison.projectId, {
          comparisonId: id,
          error: reason,
        });
        return;
      }
      if (await store.loadProject(id)) {
        await store.audit('project.delete_failed', id, { projectId: id, error: reason });
      }
    },
  };
}

export type DeleteJobRunner = ReturnType<typeof createDeleteJob>;
