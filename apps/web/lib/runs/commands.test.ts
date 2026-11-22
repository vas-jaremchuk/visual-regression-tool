import type { ItemStatus, PermissionAction, RunStatus } from '@vrt/shared';
import { describe, expect, it } from 'vitest';
import { ForbiddenError } from '../auth/assert-can';
import { RequestError } from '../members/errors';
import {
  createRunCommands,
  LabelTakenError,
  type NewRun,
  type RunsGateway,
  type StartRunInput,
} from './commands';
import type { PlannedItem } from './plan';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const SNAPSHOT = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-11-21T09:05:07.000Z');
const LABEL = '2026-11-21_09-05-07';

interface Run {
  id: string;
  projectId: string;
  label: string;
  status: RunStatus;
  cancelRequestedAt: string | null;
  workflowId?: string;
  insert?: NewRun;
}
interface Item extends PlannedItem {
  id: string;
  runId: string;
  status: ItemStatus;
  attempts: number;
  error: string | null;
}

function setup(options: { role?: 'editor' | 'viewer'; workerDown?: boolean } = {}) {
  const state = {
    runs: [] as Run[],
    items: [] as Item[],
    audits: [] as { action: string; details: unknown }[],
    started: [] as string[],
    cancelled: [] as string[],
    baseline: null as string | null,
  };
  let nextId = 0;
  const db: RunsGateway = {
    loadProject: async (id) =>
      id === PROJECT ? { id, slug: 'acme', archived: false, capture: { settleMs: 3000 } } : null,
    loadViewports: async () => [
      {
        slug: 'desktop',
        width: 1280,
        height: 900,
        deviceScaleFactor: 1,
        isMobile: false,
        enabled: true,
      },
      {
        slug: 'mobile',
        width: 390,
        height: 844,
        deviceScaleFactor: 1,
        isMobile: true,
        enabled: true,
      },
    ],
    loadSnapshot: async (projectId, id) =>
      projectId === PROJECT && id === SNAPSHOT ? { status: 'completed' } : null,
    loadSnapshotUrls: async () => [
      { url: 'https://example.com/', kind: 'page' },
      { url: 'https://example.com/a', kind: 'page' },
      { url: 'https://example.com/b', kind: 'page' },
      { url: 'https://example.com/doc.pdf', kind: 'file' },
    ],
    loadIgnoreRules: async () => [],
    findActiveRun: async (projectId) =>
      state.runs.find(
        (r) => r.projectId === projectId && ['queued', 'running'].includes(r.status),
      ) ?? null,
    labelsStartingWith: async (projectId, prefix) =>
      state.runs
        .filter((r) => r.projectId === projectId && r.label.startsWith(prefix))
        .map((r) => r.label),
    insertRun: async (run) => {
      if (state.runs.some((r) => r.projectId === run.projectId && r.label === run.label)) {
        throw new LabelTakenError('duplicate');
      }
      const id = `run-${++nextId}`;
      state.runs.push({
        id,
        projectId: run.projectId,
        label: run.label,
        status: 'queued',
        cancelRequestedAt: null,
        insert: run,
      });
      return { id };
    },
    insertItems: async (runId, items) => {
      for (const item of items) {
        state.items.push({
          ...item,
          id: `item-${++nextId}`,
          runId,
          status: 'pending',
          attempts: 0,
          error: null,
        });
      }
    },
    loadRun: async (id) => {
      const run = state.runs.find((r) => r.id === id);
      return run ? { ...run } : null;
    },
    updateRun: async (id, patch) => {
      const run = state.runs.find((r) => r.id === id)!;
      if (patch.status) run.status = patch.status;
      if (patch.workflow_id) run.workflowId = patch.workflow_id;
      if (patch.cancel_requested_at !== undefined)
        run.cancelRequestedAt = patch.cancel_requested_at;
    },
    updateItems: async (runId, from, patch) => {
      const matched = state.items.filter((i) => i.runId === runId && from.includes(i.status));
      for (const item of matched) {
        item.status = patch.status;
        if (patch.attempts !== undefined) item.attempts = patch.attempts;
        if (patch.error !== undefined) item.error = patch.error;
      }
      return matched.length;
    },
    setBaseline: async (_projectId, runId) => {
      state.baseline = runId;
    },
    audit: async (action, _projectId, details) => {
      state.audits.push({ action, details });
    },
  };
  const commands = createRunCommands({
    authorize: async (action: PermissionAction) => {
      if (options.role === 'viewer') throw new ForbiddenError(action);
    },
    db,
    worker: {
      startCapture: async ({ runId }) => {
        if (options.workerDown) throw new Error('connect ECONNREFUSED');
        state.started.push(runId);
        return { workflowId: `wf-${runId}-${state.started.length}` };
      },
      cancelCapture: async (runId) => {
        state.cancelled.push(runId);
      },
    },
    now: () => NOW,
    log: () => {},
  });
  return { state, commands };
}

const input: StartRunInput = {
  snapshotId: SNAPSHOT,
  viewports: ['desktop', 'mobile'],
  scope: 'all',
  dryRun: false,
};

async function rejection(promise: Promise<unknown>): Promise<RequestError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(RequestError);
  return error as RequestError;
}

describe('startRun', () => {
  it('creates the run with 7 items (3 pages × 2 viewports + 1 file) and starts the workflow', async () => {
    const { state, commands } = setup();
    const result = await commands.startRun(PROJECT, USER, { ...input, note: ' before deploy ' });
    expect(result).toEqual({ dryRun: false, runId: 'run-1', label: LABEL });
    expect(state.items).toHaveLength(7);
    expect(state.started).toEqual(['run-1']);
    const run = state.runs[0]!;
    expect(run.workflowId).toBe('wf-run-1-1');
    expect(run.insert).toMatchObject({
      snapshotId: SNAPSHOT,
      viewportSlugs: ['desktop', 'mobile'],
      note: 'before deploy',
      startedBy: USER,
    });
    // Settings are frozen into the run.
    expect(run.insert!.settings).toMatchObject({
      settleMs: 3000,
      scope: 'all',
      viewports: [
        { slug: 'desktop', width: 1280, height: 900 },
        { slug: 'mobile', width: 390, height: 844 },
      ],
    });
    expect(state.audits).toEqual([
      {
        action: 'run.start',
        details: { runId: 'run-1', label: LABEL, items: 7, workflowId: 'wf-run-1-1' },
      },
    ]);
  });

  it('dry run lists the items without writing anything', async () => {
    const { state, commands } = setup();
    const result = await commands.startRun(PROJECT, USER, { ...input, dryRun: true });
    expect(result.dryRun && result.items).toHaveLength(7);
    expect(state.runs).toEqual([]);
    expect(state.started).toEqual([]);
  });

  it('second run while one is active → 409 with the active run link', async () => {
    const { state, commands } = setup();
    await commands.startRun(PROJECT, USER, input);
    const error = await rejection(commands.startRun(PROJECT, USER, input));
    expect(error.status).toBe(409);
    expect(error.details).toEqual({
      activeRun: { id: 'run-1', label: LABEL, url: '/p/acme/runs/run-1' },
    });
    expect(state.runs).toHaveLength(1);
  });

  it('appends -2 when the label is taken', async () => {
    const { state, commands } = setup();
    await commands.startRun(PROJECT, USER, input);
    state.runs[0]!.status = 'completed';
    const result = await commands.startRun(PROJECT, USER, input);
    expect(result).toMatchObject({ label: `${LABEL}-2` });
  });

  it('rejects unknown viewports and an empty selection', async () => {
    const { commands } = setup();
    expect(
      (await rejection(commands.startRun(PROJECT, USER, { ...input, viewports: ['tv'] }))).status,
    ).toBe(422);
    const custom = { ...input, scope: 'custom' as const, urls: ['https://nope.test/'] };
    const error = await rejection(commands.startRun(PROJECT, USER, custom));
    expect(error.details).toEqual({ unknownUrls: ['https://nope.test/'] });
  });

  it('fails the run and its items when the worker cannot start it', async () => {
    const { state, commands } = setup({ workerDown: true });
    const error = await rejection(commands.startRun(PROJECT, USER, input));
    expect(error.status).toBe(502);
    expect(state.runs[0]!.status).toBe('failed');
    expect(state.items.every((i) => i.status === 'failed')).toBe(true);
  });

  it('viewers are forbidden', async () => {
    const { commands } = setup({ role: 'viewer' });
    await expect(commands.startRun(PROJECT, USER, input)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('cancelRun', () => {
  it('records the cancel request and tells the worker; items are left to the workflow', async () => {
    const { state, commands } = setup();
    const { runId } = (await commands.startRun(PROJECT, USER, input)) as { runId: string };
    state.items[0]!.status = 'done';
    await commands.cancelRun(runId);
    expect(state.runs[0]!.cancelRequestedAt).toBe(NOW.toISOString());
    expect(state.cancelled).toEqual([runId]);
    expect(state.items[0]!.status).toBe('done');
    expect(state.audits.at(-1)).toMatchObject({ action: 'run.cancel' });
  });

  it('rejects a finished run', async () => {
    const { state, commands } = setup();
    const { runId } = (await commands.startRun(PROJECT, USER, input)) as { runId: string };
    state.runs[0]!.status = 'completed';
    expect((await rejection(commands.cancelRun(runId))).status).toBe(422);
  });

  it('404 for a run the user cannot see', async () => {
    const { commands } = setup();
    expect((await rejection(commands.cancelRun('missing'))).status).toBe(404);
  });
});

describe('retryFailed', () => {
  it('resets only the failed items and restarts the same run (same label/prefix)', async () => {
    const { state, commands } = setup();
    const { runId, label } = (await commands.startRun(PROJECT, USER, input)) as {
      runId: string;
      label: string;
    };
    state.items.forEach((item, i) => {
      item.status = i < 2 ? 'failed' : 'done';
      item.attempts = 3;
    });
    state.runs[0]!.status = 'completed_with_errors';

    const result = await commands.retryFailed(runId);
    expect(result).toEqual({ workflowId: 'wf-run-1-2' });
    expect(state.items.map((i) => i.status)).toEqual([
      'pending',
      'pending',
      'done',
      'done',
      'done',
      'done',
      'done',
    ]);
    expect(state.items[0]).toMatchObject({ attempts: 0, error: null });
    expect(state.items[2]!.attempts).toBe(3);
    expect(state.runs).toHaveLength(1);
    expect(state.runs[0]).toMatchObject({ label, status: 'running' });
    expect(state.started).toEqual([runId, runId]);
    expect(state.audits.at(-1)).toMatchObject({
      action: 'run.retry_failed',
      details: { items: 2 },
    });
  });

  it('rejects an active run and a run without failed items', async () => {
    const { state, commands } = setup();
    const { runId } = (await commands.startRun(PROJECT, USER, input)) as { runId: string };
    expect((await rejection(commands.retryFailed(runId))).status).toBe(422);
    state.runs[0]!.status = 'completed_with_errors';
    expect((await rejection(commands.retryFailed(runId))).status).toBe(422);
  });

  it('409 when another run of the project is active', async () => {
    const { state, commands } = setup();
    const first = (await commands.startRun(PROJECT, USER, input)) as { runId: string };
    state.runs[0]!.status = 'completed_with_errors';
    state.items[0]!.status = 'failed';
    await commands.startRun(PROJECT, USER, input);
    expect((await rejection(commands.retryFailed(first.runId))).status).toBe(409);
  });
});

describe('setBaseline', () => {
  it('sets the baseline through the RPC', async () => {
    const { state, commands } = setup();
    const { runId } = (await commands.startRun(PROJECT, USER, input)) as { runId: string };
    await commands.setBaseline(runId);
    expect(state.baseline).toBe(runId);
  });
});
