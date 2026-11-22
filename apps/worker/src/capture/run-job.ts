import {
  CAPTURE_BATCH_SIZE,
  JOB_POLL_INTERVAL_MS,
  RUN_HARD_TIMEOUT_MS,
  type CaptureMsg,
  type ItemKind,
  type ItemStatus,
  type RunStatus,
} from '@vrt/shared';

/**
 * Capture run job (06 §2 and §4, REQ-JOB-1/3). `CaptureRunWorkflow` runs `prepare`, `enqueue`,
 * then `poll` every `JOB_POLL_INTERVAL_MS` until the items are final, the run is cancelled or
 * `RUN_HARD_TIMEOUT_MS` passed, then `finalise`. Each is one durable step; state lives in the
 * database, step results are small.
 */

export interface RunRow {
  id: string;
  projectId: string;
  label: string;
  status: RunStatus;
  startedAt: string | null;
  cancelRequestedAt: string | null;
  workflowId: string | null;
}

export interface PendingItem {
  id: string;
  kind: ItemKind;
  url: string;
  viewportSlug: string | null;
}

export type ItemCounts = Record<ItemStatus, number>;

export interface RunPatch {
  status?: RunStatus;
  started_at?: string;
  finished_at?: string | null;
  cancel_requested_at?: string;
}

/** Database access the job needs (service role in production, in-memory in tests). */
export interface RunStore {
  loadRun(runId: string): Promise<RunRow | null>;
  loadBucket(projectId: string): Promise<string>;
  updateRun(runId: string, patch: RunPatch): Promise<void>;
  listPendingItems(runId: string): Promise<PendingItem[]>;
  countItems(runId: string): Promise<ItemCounts>;
  /** Sets every item of the run whose status is in `from` to `to` (and `error`, when given). */
  setItemStatus(runId: string, from: ItemStatus[], to: ItemStatus, error?: string): Promise<void>;
  refreshCounts(runId: string): Promise<void>;
  /** Audit entry without a user actor (the worker acts for the system). */
  audit(action: string, projectId: string, details: Record<string, unknown>): Promise<void>;
}

export type RunEvent = 'run_completed' | 'run_failed';

/** Notification hook (06 §2 step 4): `run_completed` / `run_failed` to the project's channels. */
export interface RunNotifier {
  notify(
    event: RunEvent,
    context: { projectId: string; runId: string; error?: string },
  ): Promise<void>;
}

export const noopRunNotifier: RunNotifier = { notify: async () => {} };

export interface RunJobDeps {
  store: RunStore;
  /** Creates the project's bucket if missing (`BucketAdmin.ensure`, 409 tolerated). */
  ensureBucket(name: string): Promise<{ created: boolean }>;
  /** Sends messages to `vrt-capture`. */
  enqueue(messages: CaptureMsg[]): Promise<void>;
  notifier?: RunNotifier;
  now?: () => Date;
}

/** Statuses a run can be worked on in; anything else is final. */
export const ACTIVE_RUN_STATUSES: readonly RunStatus[] = ['queued', 'running'];

/** Poll iterations before the hard timeout. */
export const MAX_POLLS = Math.ceil(RUN_HARD_TIMEOUT_MS / JOB_POLL_INTERVAL_MS);

/** Messages per `sendBatch` call (Queues limit, LIMITS.md). */
export const SEND_BATCH_LIMIT = 100;

export const TIMEOUT_ERROR = 'timeout';

export class RunNotFoundError extends Error {
  constructor(runId: string) {
    super(`Run ${runId} not found`);
    this.name = 'RunNotFoundError';
  }
}

/**
 * Groups pending items into queue messages (06 §2 step 2): ordered by kind, then url; pages of
 * the same viewport travel together, files together, at most `size` per message.
 */
export function captureBatches(
  runId: string,
  items: readonly PendingItem[],
  size = CAPTURE_BATCH_SIZE,
): CaptureMsg[] {
  const groups = new Map<string, PendingItem[]>();
  const sorted = [...items].sort(
    (a, b) =>
      a.kind.localeCompare(b.kind) ||
      (a.viewportSlug ?? '').localeCompare(b.viewportSlug ?? '') ||
      (a.url < b.url ? -1 : a.url > b.url ? 1 : 0),
  );
  for (const item of sorted) {
    const key = item.kind === 'file' ? 'file' : `page:${item.viewportSlug ?? ''}`;
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  const messages: CaptureMsg[] = [];
  for (const group of groups.values()) {
    for (let i = 0; i < group.length; i += size) {
      messages.push({ v: 1, runId, itemIds: group.slice(i, i + size).map((item) => item.id) });
    }
  }
  return messages;
}

/** True when no item is waiting or being captured. */
export function isSettled(counts: ItemCounts): boolean {
  return counts.pending === 0 && counts.processing === 0;
}

/** Final status of a run whose items are all final (06 §2). */
export function finalStatus(counts: ItemCounts, cancelRequested: boolean): RunStatus {
  if (cancelRequested) return 'cancelled';
  return counts.failed > 0 ? 'completed_with_errors' : 'completed';
}

/** Event a finished run notifies (06 §2 step 4); a cancelled run notifies nobody. */
export function runEvent(status: RunStatus): RunEvent | null {
  if (status === 'completed' || status === 'completed_with_errors') return 'run_completed';
  if (status === 'failed') return 'run_failed';
  return null;
}

export interface PollResult {
  settled: boolean;
  cancelRequested: boolean;
  counts: ItemCounts;
}

export function createRunJob(runId: string, deps: RunJobDeps) {
  const { store } = deps;
  const now = () => (deps.now?.() ?? new Date()).toISOString();
  const notifier = deps.notifier ?? noopRunNotifier;

  async function loadRun(): Promise<RunRow> {
    const run = await store.loadRun(runId);
    if (!run) throw new RunNotFoundError(runId);
    return run;
  }

  const job = {
    /**
     * Ensures the bucket and sets the run `running`. Returns `skip` when the run is already
     * final, so a duplicate or late workflow does not reopen it.
     */
    async prepare(): Promise<{ skip: boolean }> {
      const run = await loadRun();
      if (!ACTIVE_RUN_STATUSES.includes(run.status)) return { skip: true };
      if (!run.cancelRequestedAt) await deps.ensureBucket(await store.loadBucket(run.projectId));
      await store.updateRun(runId, {
        status: 'running',
        started_at: run.startedAt ?? now(),
        finished_at: null,
      });
      return { skip: false };
    },

    /** Sends every `pending` item to `vrt-capture`. Re-sending is safe: final items are skipped. */
    async enqueue(): Promise<{ items: number; messages: number }> {
      const run = await loadRun();
      if (run.cancelRequestedAt) return { items: 0, messages: 0 };
      const items = await store.listPendingItems(runId);
      const messages = captureBatches(runId, items);
      for (let i = 0; i < messages.length; i += SEND_BATCH_LIMIT) {
        await deps.enqueue(messages.slice(i, i + SEND_BATCH_LIMIT));
      }
      return { items: items.length, messages: messages.length };
    },

    async poll(): Promise<PollResult> {
      const run = await loadRun();
      await store.refreshCounts(runId);
      const counts = await store.countItems(runId);
      return {
        settled: isSettled(counts),
        cancelRequested: run.cancelRequestedAt !== null || run.status === 'cancelled',
        counts,
      };
    },

    /** Hard timeout (6 h): items that are not final fail with `timeout`. */
    async timeout(): Promise<void> {
      await store.setItemStatus(runId, ['pending', 'processing'], 'failed', TIMEOUT_ERROR);
    },

    /**
     * Computes the final status. A cancelled run keeps its finished items; the rest become
     * `skipped`. Idempotent: a run that is already final is left as it is.
     */
    async finalise(): Promise<{ status: RunStatus }> {
      const run = await loadRun();
      if (!ACTIVE_RUN_STATUSES.includes(run.status)) return { status: run.status };
      const cancelRequested = run.cancelRequestedAt !== null;
      if (cancelRequested) await store.setItemStatus(runId, ['pending', 'processing'], 'skipped');
      await store.refreshCounts(runId);
      const counts = await store.countItems(runId);
      const status = finalStatus(counts, cancelRequested);
      await store.updateRun(runId, { status, finished_at: now() });
      await store.audit(`run.${status}`, run.projectId, {
        run_id: runId,
        label: run.label,
        done: counts.done,
        failed: counts.failed,
        skipped: counts.skipped,
      });
      const event = runEvent(status);
      if (event) await notifier.notify(event, { projectId: run.projectId, runId });
      return { status };
    },

    /** Fatal error: the run fails; items that are not final fail with the reason (retryable). */
    async fail(error: unknown): Promise<void> {
      const run = await store.loadRun(runId);
      if (!run || !ACTIVE_RUN_STATUSES.includes(run.status)) return;
      const reason = (error instanceof Error ? error.message : String(error)).slice(0, 1_000);
      await store.setItemStatus(runId, ['pending', 'processing'], 'failed', reason);
      await store.refreshCounts(runId);
      await store.updateRun(runId, { status: 'failed', finished_at: now() });
      await store.audit('run.failed', run.projectId, { run_id: runId, error: reason });
      await notifier.notify('run_failed', { projectId: run.projectId, runId, error: reason });
    },

    /**
     * Cancel (06 §4): records `cancel_requested_at`; the consumer stops at the next item and the
     * workflow finalises at its next poll. When no workflow is alive to do that, finalises here.
     */
    async cancel(isWorkflowActive: (workflowId: string) => Promise<boolean>): Promise<void> {
      const run = await loadRun();
      if (!ACTIVE_RUN_STATUSES.includes(run.status)) return;
      if (!run.cancelRequestedAt) await store.updateRun(runId, { cancel_requested_at: now() });
      if (!run.workflowId || !(await isWorkflowActive(run.workflowId))) await job.finalise();
    },
  };
  return job;
}

export type RunJob = ReturnType<typeof createRunJob>;
