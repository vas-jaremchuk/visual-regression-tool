import type { ComparisonStatus, DeleteJob, PermissionAction, RunStatus } from '@vrt/shared';
import { describe, expect, it } from 'vitest';
import { ForbiddenError } from '../auth/assert-can';
import { RequestError } from '../members/errors';
import { createStorageCommands, type StorageGateway } from './commands';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const RUN_A = '44444444-4444-4444-8444-444444444441';
const RUN_B = '44444444-4444-4444-8444-444444444442';
const CMP = '55555555-5555-4555-8555-555555555551';
const CMP_LABEL = '2026-11-01_10-00-00_vs_2026-11-02_10-00-00';

function setup(
  options: {
    role?: 'admin' | 'editor';
    workerDown?: boolean;
    baseline?: string | null;
    runStatus?: RunStatus;
    cmpStatus?: ComparisonStatus;
  } = {},
) {
  const state = {
    runStatus: new Map<string, RunStatus>([
      [RUN_A, 'completed'],
      [RUN_B, options.runStatus ?? 'completed'],
    ]),
    cmpStatus: options.cmpStatus ?? ('completed' as ComparisonStatus),
    archived: false,
    projectDeleted: false,
    audits: [] as { action: string; details: unknown }[],
    jobs: [] as DeleteJob[],
    storageJobs: [] as string[],
    authorized: [] as PermissionAction[],
  };
  const baseline = options.baseline === undefined ? RUN_A : options.baseline;
  const db: StorageGateway = {
    loadRun: async (id) =>
      state.runStatus.has(id)
        ? {
            id,
            projectId: PROJECT,
            label: id === RUN_A ? '2026-11-01_10-00-00' : '2026-11-02_10-00-00',
            status: state.runStatus.get(id)!,
            isBaseline: baseline === id,
          }
        : null,
    loadComparison: async (id) =>
      id === CMP ? { id, projectId: PROJECT, label: CMP_LABEL, status: state.cmpStatus } : null,
    loadProject: async (id) => (id === PROJECT ? { id, slug: 'acme' } : null),
    comparisonsOfRun: async () => [{ id: CMP, label: CMP_LABEL, status: state.cmpStatus }],
    countObjects: async ({ runId, comparisonIds }) => (runId ? 10 : 0) + comparisonIds.length * 3,
    setRunStatus: async (id, status) => {
      state.runStatus.set(id, status);
    },
    setComparisonStatus: async (ids, status) => {
      if (ids.includes(CMP)) state.cmpStatus = status;
    },
    archiveProject: async () => {
      state.archived = true;
    },
    deleteProjectRow: async () => {
      state.projectDeleted = true;
    },
    audit: async (action, _projectId, details) => {
      state.audits.push({ action, details });
    },
  };
  const commands = createStorageCommands({
    authorize: async (action) => {
      state.authorized.push(action);
      if (options.role === 'editor' && action !== 'project.view') throw new ForbiddenError(action);
    },
    db,
    worker: {
      startDelete: async (job) => {
        if (options.workerDown) throw new Error('worker down');
        state.jobs.push(job);
        return { workflowId: `wf-${state.jobs.length}` };
      },
      startStorage: async ({ projectId }) => {
        if (options.workerDown) throw new Error('worker down');
        state.storageJobs.push(projectId);
        return { workflowId: `storage-${projectId}` };
      },
    },
    log: () => {},
  });
  return { state, commands };
}

async function rejection(promise: Promise<unknown>): Promise<RequestError> {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(RequestError);
  return error as RequestError;
}

describe('deleteRun', () => {
  it('previews the comparisons that use the run and the object count without deleting', async () => {
    const { state, commands } = setup();
    const preview = await commands.deleteRun(RUN_B, false);
    expect(preview).toEqual({
      deleting: { comparisons: [{ id: CMP, label: CMP_LABEL }], objects: 13 },
    });
    expect(state.jobs).toEqual([]);
    expect(state.runStatus.get(RUN_B)).toBe('completed');
    expect(state.authorized).toEqual(['run.delete']);
  });

  it('on confirm marks the run and its comparisons deleting, starts the workflow and audits', async () => {
    const { state, commands } = setup();
    await commands.deleteRun(RUN_B, true);
    expect(state.jobs).toEqual([{ entity: 'run', id: RUN_B }]);
    expect(state.runStatus.get(RUN_B)).toBe('deleting');
    expect(state.cmpStatus).toBe('deleting');
    expect(state.audits).toEqual([
      {
        action: 'run.delete',
        details: {
          runId: RUN_B,
          label: '2026-11-02_10-00-00',
          comparisons: [CMP_LABEL],
          objects: 13,
        },
      },
    ]);
  });

  it('refuses the baseline run until the baseline changes', async () => {
    const { state, commands } = setup();
    const error = await rejection(commands.deleteRun(RUN_A, true));
    expect(error.status).toBe(422);
    expect(error.message).toMatch(/baseline/);
    expect(state.jobs).toEqual([]);

    const changed = setup({ baseline: RUN_B });
    await changed.commands.deleteRun(RUN_A, true);
    expect(changed.state.jobs).toEqual([{ entity: 'run', id: RUN_A }]);
  });

  it('refuses a running run or one used by a running comparison', async () => {
    expect(
      (await rejection(setup({ runStatus: 'running' }).commands.deleteRun(RUN_B, true))).status,
    ).toBe(409);
    expect(
      (await rejection(setup({ cmpStatus: 'running' }).commands.deleteRun(RUN_B, true))).status,
    ).toBe(409);
  });

  it('retries a delete_failed run', async () => {
    const { state, commands } = setup({ runStatus: 'delete_failed', cmpStatus: 'delete_failed' });
    await commands.deleteRun(RUN_B, true);
    expect(state.jobs).toHaveLength(1);
    expect(state.runStatus.get(RUN_B)).toBe('deleting');
  });

  it('marks the run delete_failed when the worker cannot start', async () => {
    const { state, commands } = setup({ workerDown: true });
    expect((await rejection(commands.deleteRun(RUN_B, true))).status).toBe(502);
    expect(state.runStatus.get(RUN_B)).toBe('delete_failed');
    expect(state.cmpStatus).toBe('delete_failed');
    expect(state.audits).toEqual([]);
  });

  it('is for project admins only', async () => {
    const { state, commands } = setup({ role: 'editor' });
    await expect(commands.deleteRun(RUN_B, true)).rejects.toBeInstanceOf(ForbiddenError);
    expect(state.jobs).toEqual([]);
  });

  it('answers 404 for an unknown run', async () => {
    const { commands } = setup();
    const missing = '44444444-4444-4444-8444-444444444449';
    expect((await rejection(commands.deleteRun(missing, false))).status).toBe(404);
  });
});

describe('deleteComparison', () => {
  it('previews, then deletes the comparison only', async () => {
    const { state, commands } = setup();
    expect(await commands.deleteComparison(CMP, false)).toEqual({
      deleting: { comparisons: [{ id: CMP, label: CMP_LABEL }], objects: 3 },
    });
    await commands.deleteComparison(CMP, true);
    expect(state.jobs).toEqual([{ entity: 'comparison', id: CMP }]);
    expect(state.cmpStatus).toBe('deleting');
    expect(state.runStatus.get(RUN_B)).toBe('completed');
    expect(state.audits.map((a) => a.action)).toEqual(['comparison.delete']);
  });

  it('refuses a running comparison', async () => {
    const { commands } = setup({ cmpStatus: 'running' });
    expect((await rejection(commands.deleteComparison(CMP, true))).status).toBe(409);
  });
});

describe('refreshStorage', () => {
  it('starts the storage workflow for project admins and audits', async () => {
    const { state, commands } = setup();
    expect(await commands.refreshStorage(PROJECT)).toEqual({ workflowId: `storage-${PROJECT}` });
    expect(state.authorized).toEqual(['project.settings']);
    expect(state.audits.map((a) => a.action)).toEqual(['storage.refresh']);
  });

  it('answers 502 when the worker is down', async () => {
    const { commands } = setup({ workerDown: true });
    expect((await rejection(commands.refreshStorage(PROJECT))).status).toBe(502);
  });
});

describe('deleteProject', () => {
  it('requires the slug', async () => {
    const { state, commands } = setup();
    const error = await rejection(
      commands.deleteProject(PROJECT, { confirmSlug: 'nope', deleteObjects: false }),
    );
    expect(error.status).toBe(400);
    expect(state.projectDeleted).toBe(false);
    expect(state.authorized).toEqual(['project.archive']);
  });

  it('deletes the row and keeps R2 without the cleanup option', async () => {
    const { state, commands } = setup();
    expect(
      await commands.deleteProject(PROJECT, { confirmSlug: 'acme', deleteObjects: false }),
    ).toEqual({ queued: false });
    expect(state.projectDeleted).toBe(true);
    expect(state.jobs).toEqual([]);
  });

  it('archives the project and hands R2 cleanup to the DeleteWorkflow', async () => {
    const { state, commands } = setup();
    expect(
      await commands.deleteProject(PROJECT, { confirmSlug: 'acme', deleteObjects: true }),
    ).toEqual({ queued: true });
    expect(state.archived).toBe(true);
    expect(state.projectDeleted).toBe(false);
    expect(state.jobs).toEqual([{ entity: 'project', id: PROJECT }]);
  });
});
