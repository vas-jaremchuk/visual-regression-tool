import type { Json } from '@vrt/db';
import type { IgnoreRule } from '@vrt/engine';
import type { ItemStatus, PermissionAction, RunStatus, StartRunResponse } from '@vrt/shared';
import { RequestError } from '../members/errors';
import {
  formatRunLabel,
  planRunItems,
  uniqueRunLabel,
  type PlannedItem,
  type RunScope,
  type SnapshotUrl,
} from './plan';

/**
 * Capture run commands (F-RUN-1/2/4/5, 06 §2/§4). Pure orchestration over `RunsGateway`, so the
 * rules (one active run, collision-safe labels, retry only failed items) are tested without a
 * database; `service.ts` wires the gateway to Supabase and the worker client.
 */

export interface RunProject {
  id: string;
  slug: string;
  archived: boolean;
  /** Capture settings frozen into `runs.settings` (02 §2). */
  capture: Record<string, Json>;
}

export interface RunViewport {
  slug: string;
  width: number;
  height: number;
  deviceScaleFactor: number;
  isMobile: boolean;
  enabled: boolean;
}

export interface RunRecord {
  id: string;
  projectId: string;
  label: string;
  status: RunStatus;
  cancelRequestedAt: string | null;
}

export interface NewRun {
  projectId: string;
  label: string;
  snapshotId: string;
  viewportSlugs: string[];
  settings: Json;
  note: string | null;
  startedBy: string;
}

export interface RunPatch {
  status?: RunStatus;
  workflow_id?: string;
  finished_at?: string | null;
  cancel_requested_at?: string | null;
}

export interface ItemPatch {
  status: ItemStatus;
  attempts?: number;
  error?: string | null;
  finished_at?: string | null;
}

/** Thrown by `insertRun` when the label is already used in the project (unique violation). */
export class LabelTakenError extends Error {}

export interface RunsGateway {
  loadProject(projectId: string): Promise<RunProject | null>;
  loadViewports(projectId: string): Promise<RunViewport[]>;
  loadSnapshot(projectId: string, snapshotId: string): Promise<{ status: string } | null>;
  /** The snapshot's included URLs. */
  loadSnapshotUrls(snapshotId: string): Promise<SnapshotUrl[]>;
  /** Enabled ignore rules of the project. */
  loadIgnoreRules(projectId: string): Promise<IgnoreRule[]>;
  /** A `queued`/`running` run of the project, if any. */
  findActiveRun(projectId: string): Promise<{ id: string; label: string } | null>;
  labelsStartingWith(projectId: string, prefix: string): Promise<string[]>;
  insertRun(run: NewRun): Promise<{ id: string }>;
  insertItems(runId: string, items: PlannedItem[]): Promise<void>;
  loadRun(runId: string): Promise<RunRecord | null>;
  updateRun(runId: string, patch: RunPatch): Promise<void>;
  /** Updates the run's items whose status is in `from`; returns how many changed. */
  updateItems(runId: string, from: ItemStatus[], patch: ItemPatch): Promise<number>;
  setBaseline(projectId: string, runId: string): Promise<void>;
  audit(action: string, projectId: string, details: Record<string, Json>): Promise<void>;
}

export interface CaptureWorker {
  startCapture(input: { runId: string }): Promise<{ workflowId: string }>;
  cancelCapture(runId: string): Promise<void>;
}

export interface RunCommandDeps {
  /** Throws unless the user may do `action` in the project (`assertCan`). */
  authorize(action: PermissionAction, projectId: string): Promise<void>;
  db: RunsGateway;
  worker: CaptureWorker;
  now?: () => Date;
  random?: () => number;
  log?: (error: unknown) => void;
}

export interface StartRunInput {
  snapshotId: string;
  viewports: string[];
  scope: RunScope;
  urls?: string[];
  sample?: number;
  note?: string;
  dryRun: boolean;
}

const ACTIVE: readonly RunStatus[] = ['queued', 'running'];
const RETRYABLE: readonly RunStatus[] = ['completed_with_errors', 'failed'];
const LABEL_ATTEMPTS = 5;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** F-RUN-5: 409 with a link to the active run. */
function activeRunConflict(slug: string, run: { id: string; label: string }): RequestError {
  return new RequestError(
    409,
    'conflict',
    `Run ${run.label} is still active; wait for it to finish or cancel it`,
    { activeRun: { id: run.id, label: run.label, url: `/p/${slug}/runs/${run.id}` } },
  );
}

export function createRunCommands(deps: RunCommandDeps) {
  const { db, worker } = deps;
  const now = () => deps.now?.() ?? new Date();
  const log = deps.log ?? console.error;

  async function loadProject(projectId: string): Promise<RunProject> {
    const project = await db.loadProject(projectId);
    if (!project) throw new RequestError(404, 'not_found', 'Project not found');
    if (project.archived) {
      throw new RequestError(422, 'business_rule', 'The project is archived; unarchive it first');
    }
    return project;
  }

  /** Loads the run (RLS: only runs the user can view) and checks the permission in its project. */
  async function loadRun(runId: string, action: PermissionAction): Promise<RunRecord> {
    const run = await db.loadRun(runId);
    if (!run) throw new RequestError(404, 'not_found', 'Run not found');
    await deps.authorize(action, run.projectId);
    return run;
  }

  /** Starts the workflow and records its id; a failed start fails the run and its open items. */
  async function startWorkflow(run: { id: string }): Promise<string> {
    try {
      const { workflowId } = await worker.startCapture({ runId: run.id });
      await db.updateRun(run.id, { workflow_id: workflowId });
      return workflowId;
    } catch (cause) {
      log(cause);
      const error = `Could not start the capture job: ${messageOf(cause)}`.slice(0, 1_000);
      await db.updateItems(run.id, ['pending'], { status: 'failed', error });
      await db.updateRun(run.id, { status: 'failed', finished_at: now().toISOString() });
      throw new RequestError(
        502,
        'worker_unavailable',
        'Could not start the capture job. Try again.',
      );
    }
  }

  return {
    /** POST /api/projects/:id/runs: creates the run and its items, or lists them (dry run). */
    async startRun(
      projectId: string,
      userId: string,
      input: StartRunInput,
    ): Promise<StartRunResponse> {
      await deps.authorize('run.manage', projectId);
      const project = await loadProject(projectId);

      const snapshot = await db.loadSnapshot(projectId, input.snapshotId);
      if (!snapshot) throw new RequestError(404, 'not_found', 'Snapshot not found');
      if (snapshot.status !== 'completed') {
        throw new RequestError(422, 'business_rule', 'The snapshot has not completed');
      }

      const known = new Map((await db.loadViewports(projectId)).map((v) => [v.slug, v]));
      const requested = [...new Set(input.viewports)];
      const unknown = requested.filter((slug) => !known.has(slug));
      if (unknown.length > 0) {
        throw new RequestError(422, 'business_rule', `Unknown viewports: ${unknown.join(', ')}`);
      }

      const [urls, ignoreRules] = await Promise.all([
        db.loadSnapshotUrls(input.snapshotId),
        db.loadIgnoreRules(projectId),
      ]);
      const plan = planRunItems({
        urls,
        viewports: requested,
        scope: input.scope,
        customUrls: input.urls,
        sample: input.sample,
        ignoreRules,
        random: deps.random,
      });
      if (plan.unknownUrls.length > 0) {
        throw new RequestError(422, 'business_rule', 'Some URLs are not included in the snapshot', {
          unknownUrls: plan.unknownUrls,
        });
      }
      if (plan.items.length === 0) {
        throw new RequestError(422, 'business_rule', 'Nothing to capture for this selection');
      }
      if (input.dryRun) return { dryRun: true, items: plan.items };

      const active = await db.findActiveRun(projectId);
      if (active) throw activeRunConflict(project.slug, active);

      const captureRules = ignoreRules.filter(
        (r) => !r.applies_to || r.applies_to === 'capture' || r.applies_to === 'both',
      );
      const settings = {
        ...project.capture,
        viewports: requested.map((slug) => {
          const { width, height, deviceScaleFactor, isMobile } = known.get(slug)!;
          return { slug, width, height, deviceScaleFactor, isMobile };
        }),
        ignoreRules: captureRules as unknown as Json,
        scope: input.scope,
        ...(input.sample ? { sample: input.sample } : {}),
        collisions: plan.collisions,
      } satisfies Record<string, Json>;

      const base = formatRunLabel(now());
      let run: { id: string } | null = null;
      let label = base;
      for (let attempt = 0; !run; attempt++) {
        label = uniqueRunLabel(base, await db.labelsStartingWith(projectId, base));
        try {
          run = await db.insertRun({
            projectId,
            label,
            snapshotId: input.snapshotId,
            viewportSlugs: requested,
            settings,
            note: input.note?.trim() || null,
            startedBy: userId,
          });
        } catch (error) {
          if (!(error instanceof LabelTakenError) || attempt + 1 >= LABEL_ATTEMPTS) throw error;
        }
      }

      try {
        await db.insertItems(run.id, plan.items);
      } catch (error) {
        await db.updateRun(run.id, { status: 'failed', finished_at: now().toISOString() });
        throw error;
      }
      const workflowId = await startWorkflow(run);
      await db.audit('run.start', projectId, {
        runId: run.id,
        label,
        items: plan.items.length,
        workflowId,
      });
      return { dryRun: false, runId: run.id, label };
    },

    /** POST /api/runs/:id/cancel (06 §4): finished items are kept. */
    async cancelRun(runId: string): Promise<void> {
      const run = await loadRun(runId, 'run.manage');
      if (!ACTIVE.includes(run.status)) {
        throw new RequestError(422, 'business_rule', `Run ${run.label} is ${run.status}`);
      }
      if (!run.cancelRequestedAt) {
        await db.updateRun(runId, { cancel_requested_at: now().toISOString() });
      }
      try {
        await worker.cancelCapture(runId);
      } catch (error) {
        // The request is recorded: the consumer and the workflow stop on their own.
        log(error);
      }
      await db.audit('run.cancel', run.projectId, { runId, label: run.label });
    },

    /** POST /api/runs/:id/retry-failed (06 §4): only failed items, same run, label and prefix. */
    async retryFailed(runId: string): Promise<{ workflowId: string }> {
      const run = await loadRun(runId, 'run.manage');
      const project = await loadProject(run.projectId);
      if (!RETRYABLE.includes(run.status)) {
        throw new RequestError(
          422,
          'business_rule',
          `Run ${run.label} is ${run.status}; only finished runs with errors can be retried`,
        );
      }
      const active = await db.findActiveRun(run.projectId);
      if (active) throw activeRunConflict(project.slug, active);

      const reset = await db.updateItems(runId, ['failed'], {
        status: 'pending',
        attempts: 0,
        error: null,
        finished_at: null,
      });
      if (reset === 0) {
        throw new RequestError(422, 'business_rule', `Run ${run.label} has no failed items`);
      }
      await db.updateRun(runId, {
        status: 'running',
        finished_at: null,
        cancel_requested_at: null,
      });
      const workflowId = await startWorkflow(run);
      await db.audit('run.retry_failed', run.projectId, {
        runId,
        label: run.label,
        items: reset,
        workflowId,
      });
      return { workflowId };
    },

    /** POST /api/runs/:id/baseline (F-REVIEW-5): RPC `set_baseline` checks and audits. */
    async setBaseline(runId: string): Promise<void> {
      const run = await loadRun(runId, 'baseline.set');
      await db.setBaseline(run.projectId, runId);
    },
  };
}
