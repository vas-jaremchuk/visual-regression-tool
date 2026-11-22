import type { DiffRequest, DiffResponse } from '@vrt/shared';
import { describe, expect, it, vi } from 'vitest';
import { createLogger } from '../logger';
import type { CompareSettings } from './compare-job';
import {
  containerDiff,
  DiffContainerError,
  processDiffMessage,
  type DiffComparison,
  type DiffItem,
  type DiffItemResult,
  type DiffRepo,
} from './diff-consumer';

const CMP = '00000000-0000-0000-0000-0000000000c1';
const ID1 = '00000000-0000-0000-0000-000000000001';
const ID2 = '00000000-0000-0000-0000-000000000002';

const settings: CompareSettings = {
  threshold: 0.1,
  changeThresholdPct: 0.05,
  maxPageHeight: 16384,
  checkRedirects: true,
  ignoreRules: [
    {
      type: 'region',
      url_pattern: 'https://e.test/**',
      region: { x: 0, y: 0, width: 10, height: 10 },
    },
    {
      type: 'region',
      url_pattern: 'https://other.test/**',
      region: { x: 5, y: 5, width: 1, height: 1 },
    },
  ],
};

function item(id: string, url: string, extra: Partial<DiffItem> = {}): DiffItem {
  return {
    id,
    url,
    viewportSlug: 'desktop',
    status: 'pending',
    beforeKey: `screenshots/b/desktop/${id}.png`,
    afterKey: `screenshots/a/desktop/${id}.png`,
    diffKey: `diffs/c/desktop/${id}.png`,
    ...extra,
  };
}

function repo(items: DiffItem[], status = 'running') {
  const updates: { id: string; result: DiffItemResult }[] = [];
  const comparison: DiffComparison = { id: CMP, projectId: 'p', status, bucket: 'vrt-b', settings };
  const r: DiffRepo = {
    getComparison: async () => comparison,
    getItems: async () => items,
    update: async (id, result) => {
      updates.push({ id, result });
    },
    refreshCounts: vi.fn(async () => {}),
  };
  return { repo: r, updates };
}

const response = (changed: boolean): DiffResponse => ({
  changed,
  diffPct: changed ? 1.5 : 0,
  diffPixels: changed ? 150 : 0,
  totalPixels: 10_000,
  beforeDims: [100, 100],
  afterDims: [100, 100],
  afterSha256: 'f'.repeat(64),
});

const log = createLogger({ component: 'test' });
const msg = { v: 1 as const, comparisonId: CMP, itemIds: [ID1, ID2] };

describe('processDiffMessage', () => {
  it('posts each pending pair with thresholds and matching regions, and stores the result', async () => {
    const { repo: r, updates } = repo([
      item(ID1, 'https://e.test/'),
      item(ID2, 'https://e.test/a/'),
    ]);
    const requests: DiffRequest[] = [];
    await processDiffMessage(msg, 1, {
      repo: r,
      log,
      diff: async (req) => {
        requests.push(req);
        return response(req.afterKey.includes(ID1));
      },
    });
    expect(requests[0]).toEqual({
      bucket: 'vrt-b',
      beforeKey: `screenshots/b/desktop/${ID1}.png`,
      afterKey: `screenshots/a/desktop/${ID1}.png`,
      diffKey: `diffs/c/desktop/${ID1}.png`,
      threshold: 0.1,
      changeThresholdPct: 0.05,
      regions: [{ x: 0, y: 0, width: 10, height: 10 }],
      maxPageHeight: 16384,
    });
    expect(updates).toEqual([
      {
        id: ID1,
        result: {
          status: 'changed',
          diff_pct: 1.5,
          diff_pixels: 150,
          total_pixels: 10_000,
          before_dims: [100, 100],
          after_dims: [100, 100],
          error: null,
        },
      },
      { id: ID2, result: expect.objectContaining({ status: 'unchanged', diff_pct: 0 }) },
    ]);
    expect(r.refreshCounts).toHaveBeenCalledWith(CMP);
  });

  it('skips items that are already final (redelivery)', async () => {
    const { repo: r, updates } = repo([item(ID1, 'https://e.test/', { status: 'changed' })]);
    const diff = vi.fn();
    await processDiffMessage(msg, 1, { repo: r, log, diff });
    expect(diff).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });

  it('drops messages of a comparison that is not running', async () => {
    const { repo: r } = repo([item(ID1, 'https://e.test/')], 'completed');
    const diff = vi.fn();
    await processDiffMessage(msg, 1, { repo: r, log, diff });
    expect(diff).not.toHaveBeenCalled();
  });

  it('throws so the queue retries a transient failure, keeping the item pending', async () => {
    const { repo: r, updates } = repo([item(ID1, 'https://e.test/')]);
    const diff = vi.fn(async () => {
      throw new DiffContainerError(503, 'starting');
    });
    await expect(processDiffMessage(msg, 1, { repo: r, log, diff })).rejects.toThrow(/1 diff/);
    expect(updates).toEqual([]);
  });

  it('marks the item error on the third attempt', async () => {
    const { repo: r, updates } = repo([item(ID1, 'https://e.test/')]);
    const diff = vi.fn(async () => {
      throw new Error('network down');
    });
    await processDiffMessage(msg, 3, { repo: r, log, diff });
    expect(updates).toEqual([{ id: ID1, result: { status: 'error', error: 'network down' } }]);
  });

  it('marks the item error at once for a 4xx answer', async () => {
    const { repo: r, updates } = repo([item(ID1, 'https://e.test/')]);
    const diff = vi.fn(async () => {
      throw new DiffContainerError(422, 'image too large');
    });
    await processDiffMessage(msg, 1, { repo: r, log, diff });
    expect(updates[0]?.result).toMatchObject({
      status: 'error',
      error: expect.stringMatching(/422/),
    });
  });
});

describe('containerDiff', () => {
  const request: DiffRequest = {
    bucket: 'b',
    beforeKey: 'x.png',
    afterKey: 'y.png',
    diffKey: 'z.png',
    threshold: 0.1,
    changeThresholdPct: 0.05,
  };

  it('posts to /diff with the bearer secret and parses the answer', async () => {
    const seen: Request[] = [];
    const diff = containerDiff(async (req) => {
      seen.push(req);
      return Response.json(response(true));
    }, 'secret');
    expect(await diff(request)).toMatchObject({ changed: true, diffPct: 1.5 });
    expect(new URL(seen[0]!.url).pathname).toBe('/diff');
    expect(seen[0]!.headers.get('authorization')).toBe('Bearer secret');
    expect(await seen[0]!.json()).toEqual(request);
  });

  it('throws DiffContainerError with the status for a non-2xx answer', async () => {
    const diff = containerDiff(async () => new Response('nope', { status: 500 }), 'secret');
    await expect(diff(request)).rejects.toMatchObject({ status: 500 });
  });
});
