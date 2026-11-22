import type { ComparisonStatus, PermissionAction, RunStatus } from '@vrt/shared';
import { describe, expect, it } from 'vitest';
import { ForbiddenError } from '../auth/assert-can';
import { RequestError } from '../members/errors';
import {
  createComparisonCommands,
  type ComparisonPatch,
  type ComparisonRun,
  type ComparisonsGateway,
  type NewComparison,
} from './commands';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const OTHER = '11111111-1111-4111-8111-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const BEFORE = '44444444-4444-4444-8444-444444444441';
const AFTER = '44444444-4444-4444-8444-444444444442';
const LABEL = '2026-11-01_10-00-00_vs_2026-11-02_10-00-00';

interface Cmp extends NewComparison {
  id: string;
  status: ComparisonStatus;
  patches: ComparisonPatch[];
}

function setup(
  options: { role?: 'editor' | 'viewer'; workerDown?: boolean; archived?: boolean } = {},
) {
  const state = {
    runs: new Map<string, ComparisonRun>([
      [BEFORE, run(BEFORE, '2026-11-01_10-00-00', '2026-11-01T10:00:00Z')],
      [AFTER, run(AFTER, '2026-11-02_10-00-00', '2026-11-02T10:00:00Z')],
    ]),
    comparisons: [] as Cmp[],
    audits: [] as { action: string; details: unknown }[],
    started: [] as string[],
    authorized: [] as PermissionAction[],
  };
  const db: ComparisonsGateway = {
    loadProject: async (id) =>
      id === PROJECT ? { id, slug: 'acme', archived: options.archived ?? false } : null,
    loadRun: async (id) => state.runs.get(id) ?? null,
    findComparison: async (projectId, b, a) => {
      const found = state.comparisons.find(
        (c) => c.projectId === projectId && c.beforeRunId === b && c.afterRunId === a,
      );
      return found ? { id: found.id, label: found.label, status: found.status } : null;
    },
    loadComparison: async (id) => {
      const found = state.comparisons.find((c) => c.id === id);
      return found
        ? {
            id: found.id,
            label: found.label,
            status: found.status,
            projectId: found.projectId,
            beforeRunId: found.beforeRunId,
            afterRunId: found.afterRunId,
          }
        : null;
    },
    insertComparison: async (comparison) => {
      const id = `55555555-5555-4555-8555-${String(state.comparisons.length).padStart(12, '0')}`;
      state.comparisons.push({ ...comparison, id, status: 'queued', patches: [] });
      return { id };
    },
    updateComparison: async (id, patch) => {
      const cmp = state.comparisons.find((c) => c.id === id)!;
      cmp.patches.push(patch);
      if (patch.status) cmp.status = patch.status;
    },
    audit: async (action, _projectId, details) => {
      state.audits.push({ action, details });
    },
  };
  const commands = createComparisonCommands({
    authorize: async (action) => {
      state.authorized.push(action);
      if (options.role === 'viewer') throw new ForbiddenError(action);
    },
    db,
    worker: {
      startCompare: async ({ comparisonId }) => {
        if (options.workerDown) throw new Error('worker down');
        state.started.push(comparisonId);
        return { workflowId: `wf-${state.started.length}` };
      },
    },
    now: () => new Date('2026-11-22T10:00:00Z'),
    log: () => {},
  });
  return { state, commands };
}

function run(id: string, label: string, createdAt: string, status: RunStatus = 'completed') {
  return { id, projectId: PROJECT, label, status, createdAt };
}

const input = { beforeRunId: BEFORE, afterRunId: AFTER, replace: false };

async function rejection(promise: Promise<unknown>): Promise<RequestError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(RequestError);
  return error as RequestError;
}

describe('startComparison', () => {
  it('creates the comparison with the pair label, starts the workflow and audits', async () => {
    const { state, commands } = setup();
    const result = await commands.startComparison(PROJECT, USER, input);
    expect(result).toEqual({ comparisonId: state.comparisons[0]!.id, label: LABEL });
    expect(state.authorized).toEqual(['comparison.start']);
    expect(state.comparisons[0]).toMatchObject({
      beforeRunId: BEFORE,
      afterRunId: AFTER,
      label: LABEL,
      startedBy: USER,
    });
    expect(state.started).toEqual([result.comparisonId]);
    expect(state.comparisons[0]!.patches).toEqual([{ workflow_id: 'wf-1' }]);
    expect(state.audits).toEqual([
      { action: 'comparison.start', details: expect.objectContaining({ label: LABEL }) },
    ]);
  });

  it('accepts runs that completed with errors', async () => {
    const { state, commands } = setup();
    state.runs.set(AFTER, { ...state.runs.get(AFTER)!, status: 'completed_with_errors' });
    await expect(commands.startComparison(PROJECT, USER, input)).resolves.toMatchObject({
      label: LABEL,
    });
  });

  it('refuses viewers', async () => {
    const { commands } = setup({ role: 'viewer' });
    await expect(commands.startComparison(PROJECT, USER, input)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('refuses a run that has not completed', async () => {
    const { state, commands } = setup();
    state.runs.set(AFTER, { ...state.runs.get(AFTER)!, status: 'running' });
    const error = await rejection(commands.startComparison(PROJECT, USER, input));
    expect(error).toMatchObject({ status: 422, code: 'business_rule' });
  });

  it('refuses a run of another project', async () => {
    const { state, commands } = setup();
    state.runs.set(BEFORE, { ...state.runs.get(BEFORE)!, projectId: OTHER });
    expect(await rejection(commands.startComparison(PROJECT, USER, input))).toMatchObject({
      status: 404,
    });
  });

  it('refuses a before run that is not older than the after run', async () => {
    const { commands } = setup();
    const error = await rejection(
      commands.startComparison(PROJECT, USER, {
        beforeRunId: AFTER,
        afterRunId: BEFORE,
        replace: false,
      }),
    );
    expect(error).toMatchObject({ status: 422, message: expect.stringMatching(/older/) });
  });

  it('refuses an archived project', async () => {
    const { commands } = setup({ archived: true });
    expect(await rejection(commands.startComparison(PROJECT, USER, input))).toMatchObject({
      status: 422,
    });
  });

  it('asks for confirmation before replacing an earlier comparison of the pair', async () => {
    const { state, commands } = setup();
    const first = await commands.startComparison(PROJECT, USER, input);
    state.comparisons[0]!.status = 'completed';
    const error = await rejection(commands.startComparison(PROJECT, USER, input));
    expect(error).toMatchObject({
      status: 409,
      details: { replaceRequired: true, comparison: { id: first.comparisonId, label: LABEL } },
    });
    expect(state.started).toHaveLength(1);
  });

  it('re-runs the same comparison when replace is confirmed', async () => {
    const { state, commands } = setup();
    const first = await commands.startComparison(PROJECT, USER, input);
    state.comparisons[0]!.status = 'completed';
    const again = await commands.startComparison(PROJECT, USER, { ...input, replace: true });
    expect(again.comparisonId).toBe(first.comparisonId);
    expect(state.comparisons).toHaveLength(1);
    expect(state.comparisons[0]!.status).toBe('queued');
    expect(state.started).toEqual([first.comparisonId, first.comparisonId]);
    expect(state.audits.map((a) => a.action)).toEqual(['comparison.start', 'comparison.replace']);
  });

  it('refuses to replace a comparison that is still running', async () => {
    const { state, commands } = setup();
    await commands.startComparison(PROJECT, USER, input);
    state.comparisons[0]!.status = 'running';
    const error = await rejection(
      commands.startComparison(PROJECT, USER, { ...input, replace: true }),
    );
    expect(error).toMatchObject({ status: 409, code: 'conflict' });
  });

  it('fails the comparison and answers 502 when the worker is down', async () => {
    const { state, commands } = setup({ workerDown: true });
    const error = await rejection(commands.startComparison(PROJECT, USER, input));
    expect(error).toMatchObject({ status: 502, code: 'worker_unavailable' });
    expect(state.comparisons[0]!.status).toBe('failed');
    expect(state.audits).toEqual([]);
  });
});

describe('rediff', () => {
  async function completed(options: Parameters<typeof setup>[0] = {}) {
    const ctx = setup(options);
    const { comparisonId } = await setup().commands.startComparison(PROJECT, USER, input);
    ctx.state.comparisons.push({
      id: comparisonId,
      projectId: PROJECT,
      beforeRunId: BEFORE,
      afterRunId: AFTER,
      label: LABEL,
      startedBy: USER,
      status: 'completed',
      patches: [],
    });
    return { ...ctx, comparisonId };
  }

  it('requeues the comparison, starts the workflow and audits comparison.rediff', async () => {
    const { state, commands, comparisonId } = await completed();
    await expect(commands.rediff(comparisonId, USER)).resolves.toEqual({ workflowId: 'wf-1' });
    expect(state.authorized).toEqual(['comparison.start']);
    expect(state.started).toEqual([comparisonId]);
    expect(state.comparisons[0]!.patches).toEqual([
      { status: 'queued', started_by: USER, started_at: null, finished_at: null },
      { workflow_id: 'wf-1' },
    ]);
    expect(state.audits).toEqual([
      { action: 'comparison.rediff', details: { comparisonId, label: LABEL, workflowId: 'wf-1' } },
    ]);
  });

  it('answers 404 for an unknown comparison', async () => {
    const { commands } = setup();
    const error = await rejection(commands.rediff(AFTER, USER));
    expect(error).toMatchObject({ status: 404 });
  });

  it('refuses viewers', async () => {
    const { state, commands, comparisonId } = await completed({ role: 'viewer' });
    await expect(commands.rediff(comparisonId, USER)).rejects.toBeInstanceOf(ForbiddenError);
    expect(state.started).toEqual([]);
  });

  it('answers 409 while the comparison is still running', async () => {
    const { state, commands, comparisonId } = await completed();
    state.comparisons[0]!.status = 'running';
    const error = await rejection(commands.rediff(comparisonId, USER));
    expect(error).toMatchObject({ status: 409, code: 'conflict' });
    expect(state.started).toEqual([]);
  });

  it('refuses an archived project', async () => {
    const { commands, comparisonId } = await completed({ archived: true });
    const error = await rejection(commands.rediff(comparisonId, USER));
    expect(error).toMatchObject({ status: 422 });
  });

  it('marks the comparison failed when the worker is down', async () => {
    const { state, commands, comparisonId } = await completed({ workerDown: true });
    const error = await rejection(commands.rediff(comparisonId, USER));
    expect(error).toMatchObject({ status: 502 });
    expect(state.comparisons[0]!.status).toBe('failed');
    expect(state.audits).toEqual([]);
  });
});
