import type { Json } from '@vrt/db';
import {
  comparisonLabel,
  type ComparisonStatus,
  type PermissionAction,
  type RunStatus,
} from '@vrt/shared';
import { RequestError } from '../members/errors';

/**
 * Comparison commands (F-CMP-1, 06 §5). Pure orchestration over `ComparisonsGateway`, so the
 * rules (both runs completed and in the project, before older than after, replace only after
 * confirmation) are tested without a database; `service.ts` wires it to Supabase and the worker.
 */

export interface ComparisonRun {
  id: string;
  projectId: string;
  label: string;
  status: RunStatus;
  createdAt: string;
}

export interface ComparisonRecord {
  id: string;
  label: string;
  status: ComparisonStatus;
}

export interface NewComparison {
  projectId: string;
  beforeRunId: string;
  afterRunId: string;
  label: string;
  startedBy: string;
}

export interface ComparisonPatch {
  status?: ComparisonStatus;
  workflow_id?: string;
  started_by?: string;
  started_at?: string | null;
  finished_at?: string | null;
}

export interface ComparisonsGateway {
  loadProject(projectId: string): Promise<{ id: string; slug: string; archived: boolean } | null>;
  /** The run (RLS: only runs the user can view). */
  loadRun(runId: string): Promise<ComparisonRun | null>;
  findComparison(
    projectId: string,
    beforeRunId: string,
    afterRunId: string,
  ): Promise<ComparisonRecord | null>;
  insertComparison(comparison: NewComparison): Promise<{ id: string }>;
  updateComparison(comparisonId: string, patch: ComparisonPatch): Promise<void>;
  audit(action: string, projectId: string, details: Record<string, Json>): Promise<void>;
}

export interface CompareWorker {
  startCompare(input: { comparisonId: string }): Promise<{ workflowId: string }>;
}

export interface ComparisonCommandDeps {
  /** Throws unless the user may do `action` in the project (`assertCan`). */
  authorize(action: PermissionAction, projectId: string): Promise<void>;
  db: ComparisonsGateway;
  worker: CompareWorker;
  now?: () => Date;
  log?: (error: unknown) => void;
}

export interface StartComparisonInput {
  beforeRunId: string;
  afterRunId: string;
  replace: boolean;
}

const COMPARABLE: readonly RunStatus[] = ['completed', 'completed_with_errors'];
const ACTIVE: readonly ComparisonStatus[] = ['queued', 'running'];
const BUSY: readonly ComparisonStatus[] = [...ACTIVE, 'deleting'];

export function createComparisonCommands(deps: ComparisonCommandDeps) {
  const { db, worker } = deps;
  const now = () => deps.now?.() ?? new Date();
  const log = deps.log ?? console.error;

  async function loadRun(projectId: string, runId: string, name: string): Promise<ComparisonRun> {
    const run = await db.loadRun(runId);
    if (!run || run.projectId !== projectId) {
      throw new RequestError(404, 'not_found', `The ${name} run was not found in this project`);
    }
    if (!COMPARABLE.includes(run.status)) {
      throw new RequestError(
        422,
        'business_rule',
        `The ${name} run ${run.label} is ${run.status}; only completed runs can be compared`,
      );
    }
    return run;
  }

  return {
    /** POST /api/projects/:id/comparisons: creates (or, confirmed, replaces) and starts it. */
    async startComparison(
      projectId: string,
      userId: string,
      input: StartComparisonInput,
    ): Promise<{ comparisonId: string; label: string }> {
      await deps.authorize('comparison.start', projectId);
      const project = await db.loadProject(projectId);
      if (!project) throw new RequestError(404, 'not_found', 'Project not found');
      if (project.archived) {
        throw new RequestError(422, 'business_rule', 'The project is archived; unarchive it first');
      }
      if (input.beforeRunId === input.afterRunId) {
        throw new RequestError(422, 'business_rule', 'Pick two different runs');
      }
      const before = await loadRun(projectId, input.beforeRunId, 'before');
      const after = await loadRun(projectId, input.afterRunId, 'after');
      if (before.createdAt >= after.createdAt) {
        throw new RequestError(
          422,
          'business_rule',
          'The before run must be older than the after run',
        );
      }
      const label = comparisonLabel(before.label, after.label);

      const existing = await db.findComparison(projectId, before.id, after.id);
      let comparisonId: string;
      if (existing) {
        const link = {
          id: existing.id,
          label: existing.label,
          url: `/p/${project.slug}/comparisons/${existing.id}`,
        };
        if (BUSY.includes(existing.status)) {
          throw new RequestError(
            409,
            'conflict',
            `Comparison ${existing.label} is ${existing.status}`,
            {
              comparison: link,
            },
          );
        }
        if (!input.replace) {
          throw new RequestError(
            409,
            'conflict',
            `These runs were already compared; confirm to replace the results of ${existing.label}`,
            { comparison: link, replaceRequired: true },
          );
        }
        await db.updateComparison(existing.id, {
          status: 'queued',
          started_by: userId,
          started_at: null,
          finished_at: null,
        });
        comparisonId = existing.id;
      } else {
        comparisonId = (
          await db.insertComparison({
            projectId,
            beforeRunId: before.id,
            afterRunId: after.id,
            label,
            startedBy: userId,
          })
        ).id;
      }

      let workflowId: string;
      try {
        ({ workflowId } = await worker.startCompare({ comparisonId }));
        await db.updateComparison(comparisonId, { workflow_id: workflowId });
      } catch (cause) {
        log(cause);
        await db.updateComparison(comparisonId, {
          status: 'failed',
          finished_at: now().toISOString(),
        });
        throw new RequestError(
          502,
          'worker_unavailable',
          'Could not start the comparison job. Try again.',
        );
      }
      await db.audit(existing ? 'comparison.replace' : 'comparison.start', projectId, {
        comparisonId,
        label,
        beforeRunId: before.id,
        afterRunId: after.id,
        workflowId,
      });
      return { comparisonId, label };
    },
  };
}
