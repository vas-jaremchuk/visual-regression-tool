import type { CaptureMsg, ItemStatus } from '@vrt/shared';
import { describe, expect, it } from 'vitest';
import {
  captureBatches,
  createRunJob,
  finalStatus,
  MAX_POLLS,
  RunNotFoundError,
  type ItemCounts,
  type PendingItem,
  type RunPatch,
  type RunRow,
  type RunStore,
} from './run-job';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-11-21T12:00:00.000Z');

interface Item extends PendingItem {
  status: ItemStatus;
  error: string | null;
}

function counts(items: Item[]): ItemCounts {
  const c: ItemCounts = { pending: 0, processing: 0, done: 0, failed: 0, skipped: 0 };
  for (const item of items) c[item.status]++;
  return c;
}

/** In-memory `RunStore` plus fakes for the bucket and the queue. */
function setup(run: Partial<RunRow> = {}, items: Partial<Item>[] = []) {
  const state = {
    run: {
      id: RUN_ID,
      projectId: PROJECT_ID,
      label: '2026-11-21_12-00-00',
      status: 'queued',
      startedAt: null,
      cancelRequestedAt: null,
      workflowId: null,
      ...run,
    } as RunRow,
    items: items.map(
      (item, i): Item => ({
        id: `item-${i}`,
        kind: 'page',
        url: `https://example.com/${i}`,
        viewportSlug: 'desktop',
        status: 'pending',
        error: null,
        ...item,
      }),
    ),
    patches: [] as RunPatch[],
    audits: [] as { action: string; details: Record<string, unknown> }[],
    buckets: [] as string[],
    sent: [] as CaptureMsg[],
  };
  const store: RunStore = {
    loadRun: async (id) => (id === state.run.id ? { ...state.run } : null),
    loadBucket: async () => 'vrt-acme',
    updateRun: async (_id, patch) => {
      state.patches.push(patch);
      if (patch.status) state.run.status = patch.status;
      if (patch.started_at) state.run.startedAt = patch.started_at;
      if (patch.cancel_requested_at) state.run.cancelRequestedAt = patch.cancel_requested_at;
    },
    listPendingItems: async () =>
      state.items
        .filter((i) => i.status === 'pending')
        .map(({ id, kind, url, viewportSlug }) => ({ id, kind, url, viewportSlug })),
    countItems: async () => counts(state.items),
    setItemStatus: async (_id, from, to, error) => {
      for (const item of state.items) {
        if (!from.includes(item.status)) continue;
        item.status = to;
        if (error !== undefined) item.error = error;
      }
    },
    refreshCounts: async () => {},
    audit: async (action, _projectId, details) => {
      state.audits.push({ action, details });
    },
  };
  const job = createRunJob(RUN_ID, {
    store,
    ensureBucket: async (name) => {
      state.buckets.push(name);
      return { created: false };
    },
    enqueue: async (messages) => {
      state.sent.push(...messages);
    },
    now: () => NOW,
  });
  return { state, job };
}

/** Runs the workflow's step sequence against the fakes; `onPoll` plays the consumer. */
async function runWorkflow(
  job: ReturnType<typeof setup>['job'],
  onPoll: (i: number) => void = () => {},
  maxPolls = MAX_POLLS,
) {
  if ((await job.prepare()).skip) return null;
  await job.enqueue();
  let finished = false;
  for (let i = 0; i < maxPolls && !finished; i++) {
    onPoll(i);
    const state = await job.poll();
    finished = state.settled || state.cancelRequested;
  }
  if (!finished) await job.timeout();
  return job.finalise();
}

describe('captureBatches', () => {
  it('orders by kind and url and keeps pages of one viewport together', () => {
    const items: PendingItem[] = [
      { id: 'f1', kind: 'file', url: 'https://e.com/a.pdf', viewportSlug: null },
      { id: 'm2', kind: 'page', url: 'https://e.com/b', viewportSlug: 'mobile' },
      { id: 'd2', kind: 'page', url: 'https://e.com/b', viewportSlug: 'desktop' },
      { id: 'd1', kind: 'page', url: 'https://e.com/a', viewportSlug: 'desktop' },
      { id: 'm1', kind: 'page', url: 'https://e.com/a', viewportSlug: 'mobile' },
    ];
    expect(captureBatches(RUN_ID, items).map((m) => m.itemIds)).toEqual([
      ['f1'],
      ['d1', 'd2'],
      ['m1', 'm2'],
    ]);
  });

  it('splits groups into messages of the batch size', () => {
    const items: PendingItem[] = Array.from({ length: 23 }, (_, i) => ({
      id: `p${String(i).padStart(2, '0')}`,
      kind: 'page',
      url: `https://e.com/${String(i).padStart(2, '0')}`,
      viewportSlug: 'desktop',
    }));
    const messages = captureBatches(RUN_ID, items);
    expect(messages.map((m) => m.itemIds.length)).toEqual([10, 10, 3]);
    expect(messages[0]).toMatchObject({ v: 1, runId: RUN_ID });
  });
});

describe('finalStatus', () => {
  const base: ItemCounts = { pending: 0, processing: 0, done: 3, failed: 0, skipped: 0 };
  it('is completed, completed_with_errors or cancelled', () => {
    expect(finalStatus(base, false)).toBe('completed');
    expect(finalStatus({ ...base, failed: 1 }, false)).toBe('completed_with_errors');
    expect(finalStatus({ ...base, skipped: 2 }, true)).toBe('cancelled');
  });
});

describe('capture run job', () => {
  it('ensures the bucket, enqueues the pending items and completes', async () => {
    const { state, job } = setup({}, [{}, {}, { kind: 'file', viewportSlug: null }]);
    const result = await runWorkflow(job, () => {
      for (const item of state.items) item.status = 'done';
    });
    expect(result).toEqual({ status: 'completed' });
    expect(state.buckets).toEqual(['vrt-acme']);
    expect(state.sent.flatMap((m) => m.itemIds).sort()).toEqual(['item-0', 'item-1', 'item-2']);
    expect(state.patches[0]).toEqual({
      status: 'running',
      started_at: NOW.toISOString(),
      finished_at: null,
    });
    expect(state.patches.at(-1)).toEqual({ status: 'completed', finished_at: NOW.toISOString() });
    expect(state.audits).toEqual([
      {
        action: 'run.completed',
        details: { run_id: RUN_ID, label: state.run.label, done: 3, failed: 0, skipped: 0 },
      },
    ]);
  });

  it('ends completed_with_errors when an item failed', async () => {
    const { state, job } = setup({}, [{}, {}]);
    const result = await runWorkflow(job, () => {
      state.items[0]!.status = 'done';
      state.items[1]!.status = 'failed';
    });
    expect(result).toEqual({ status: 'completed_with_errors' });
  });

  it('keeps polling while items are pending or processing', async () => {
    const { state, job } = setup({}, [{}]);
    let polls = 0;
    await runWorkflow(job, (i) => {
      polls++;
      state.items[0]!.status = i < 2 ? 'processing' : 'done';
    });
    expect(polls).toBe(3);
  });

  it('cancel stops the run: done items are kept, the rest skipped, run cancelled', async () => {
    const { state, job } = setup({}, [{}, {}, {}]);
    const result = await runWorkflow(job, (i) => {
      if (i === 0) {
        state.items[0]!.status = 'done';
        state.items[1]!.status = 'processing';
        state.run.cancelRequestedAt = NOW.toISOString();
      }
    });
    expect(result).toEqual({ status: 'cancelled' });
    expect(state.items.map((i) => i.status)).toEqual(['done', 'skipped', 'skipped']);
    expect(state.audits[0]?.action).toBe('run.cancelled');
  });

  it('cancel without a live workflow finalises the run itself', async () => {
    const { state, job } = setup({ status: 'running', workflowId: 'wf-1' }, [
      { status: 'done' },
      {},
    ]);
    await job.cancel(async () => false);
    expect(state.run.status).toBe('cancelled');
    expect(state.run.cancelRequestedAt).toBe(NOW.toISOString());
    expect(state.items.map((i) => i.status)).toEqual(['done', 'skipped']);
  });

  it('cancel with a live workflow only records the request', async () => {
    const { state, job } = setup({ status: 'running', workflowId: 'wf-1' }, [{}]);
    await job.cancel(async (workflowId) => workflowId === 'wf-1');
    expect(state.run.status).toBe('running');
    expect(state.run.cancelRequestedAt).toBe(NOW.toISOString());
    expect(state.items[0]!.status).toBe('pending');
  });

  it('cancel of a finished run changes nothing', async () => {
    const { state, job } = setup({ status: 'completed' }, [{ status: 'done' }]);
    await job.cancel(async () => false);
    expect(state.patches).toEqual([]);
  });

  it('does not enqueue anything when the run was cancelled before it started', async () => {
    const { state, job } = setup({ cancelRequestedAt: NOW.toISOString() }, [{}]);
    const result = await runWorkflow(job);
    expect(state.buckets).toEqual([]);
    expect(state.sent).toEqual([]);
    expect(result).toEqual({ status: 'cancelled' });
  });

  it('times out: items that are not final fail with "timeout"', async () => {
    const { state, job } = setup({}, [{ status: 'done' }, {}]);
    const result = await runWorkflow(job, () => {}, 3);
    expect(result).toEqual({ status: 'completed_with_errors' });
    expect(state.items[1]).toMatchObject({ status: 'failed', error: 'timeout' });
  });

  it('polls for 6 hours at most', () => {
    expect(MAX_POLLS).toBe(1440);
  });

  it('retry after a finished run re-processes only the failed items, same label', async () => {
    // Retry failed (web) reset the failed item to pending and the run to running.
    const { state, job } = setup({ status: 'running', startedAt: '2026-11-21T10:00:00.000Z' }, [
      { status: 'done' },
      { status: 'pending' },
      { status: 'skipped' },
    ]);
    const label = state.run.label;
    const result = await runWorkflow(job, () => {
      state.items[1]!.status = 'done';
    });
    expect(state.sent.flatMap((m) => m.itemIds)).toEqual(['item-1']);
    expect(state.run.label).toBe(label);
    expect(state.run.startedAt).toBe('2026-11-21T10:00:00.000Z');
    expect(result).toEqual({ status: 'completed' });
  });

  it('skips a run that is already final', async () => {
    const { state, job } = setup({ status: 'cancelled' }, [{}]);
    expect(await job.prepare()).toEqual({ skip: true });
    expect(state.patches).toEqual([]);
  });

  it('fails the run on a fatal error; open items fail with the reason', async () => {
    const { state, job } = setup({ status: 'running' }, [{ status: 'done' }, {}]);
    await job.fail(new Error('bucket create failed'));
    expect(state.run.status).toBe('failed');
    expect(state.items[1]).toMatchObject({ status: 'failed', error: 'bucket create failed' });
    expect(state.audits[0]).toMatchObject({ action: 'run.failed' });
  });

  it('throws for an unknown run', async () => {
    const { job } = setup();
    const other = createRunJob('33333333-3333-4333-8333-333333333333', {
      store: { loadRun: async () => null } as unknown as RunStore,
      ensureBucket: async () => ({ created: false }),
      enqueue: async () => {},
    });
    await expect(other.prepare()).rejects.toBeInstanceOf(RunNotFoundError);
    expect(job).toBeDefined();
  });
});
