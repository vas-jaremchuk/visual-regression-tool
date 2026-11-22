import type { StorageUsage } from '@vrt/shared';
import { FakeObjectStore } from '@vrt/storage/testing';
import { describe, expect, it } from 'vitest';
import { createStorageJob, type StorageStore } from './storage-job';

const PROJECT = '00000000-0000-0000-0000-0000000000a1';
const BUCKET = 'vrt-fixture';

class MemoryStore implements StorageStore {
  row: {
    status: string;
    usage?: StorageUsage;
    refreshedAt?: string;
    error?: string;
    workflowId?: string;
  } | null = null;

  async loadProject(projectId: string) {
    return projectId === PROJECT ? { id: PROJECT, bucket: BUCKET } : null;
  }
  async markRunning(_p: string, _b: string, workflowId: string) {
    this.row = { status: 'running', workflowId };
  }
  async saveUsage(_p: string, usage: StorageUsage, refreshedAt: string) {
    this.row = { ...this.row, status: 'completed', usage, refreshedAt };
  }
  async markFailed(_p: string, error: string) {
    this.row = { ...this.row, status: 'failed', error };
  }
}

/** Fixture bucket with objects of known sizes under every prefix group. */
async function fixtureBucket() {
  const objects = new FakeObjectStore();
  const sizes: Record<string, number> = {
    'screenshots/2026-11-01_10-00-00/desktop/home.png': 1200,
    'screenshots/2026-11-01_10-00-00/desktop/about.png': 800,
    'screenshots/2026-11-01_10-00-00/_files/doc.pdf.txt': 64,
    'diffs/2026-11-01_10-00-00_vs_2026-11-02_10-00-00/desktop/home.png': 300,
    'reports/2026-11-01_10-00-00_vs_2026-11-02_10-00-00/index.html': 50,
    '_vrt/probe.txt': 2,
  };
  for (const [key, size] of Object.entries(sizes)) {
    await objects.put(BUCKET, key, new Uint8Array(size), 'application/octet-stream');
  }
  return { objects, sizes };
}

describe('StorageJob', () => {
  it('caches totals that match the R2 listing of the fixture bucket', async () => {
    const store = new MemoryStore();
    const { objects, sizes } = await fixtureBucket();
    const job = createStorageJob(PROJECT, {
      store,
      objects,
      now: () => new Date('2026-11-22T10:00:00Z'),
    });

    const started = await job.start('wf-1');
    expect(started).toEqual({ bucket: BUCKET });
    expect(store.row).toEqual({ status: 'running', workflowId: 'wf-1' });
    await job.measure(started!.bucket);

    const listed: { key: string; size: number }[] = [];
    for await (const entry of objects.list(BUCKET, '')) listed.push(entry);
    expect(listed).toHaveLength(Object.keys(sizes).length);

    expect(store.row?.status).toBe('completed');
    expect(store.row?.refreshedAt).toBe('2026-11-22T10:00:00.000Z');
    expect(store.row?.usage).toEqual({
      totalBytes: listed.reduce((sum, o) => sum + o.size, 0),
      objectCount: listed.length,
      groups: [
        { prefix: 'screenshots', bytes: 2064, objects: 3 },
        { prefix: 'diffs', bytes: 300, objects: 1 },
        { prefix: 'reports', bytes: 50, objects: 1 },
        { prefix: 'other', bytes: 2, objects: 1 },
      ],
    });
  });

  it('does nothing for a deleted project', async () => {
    const store = new MemoryStore();
    const job = createStorageJob('00000000-0000-0000-0000-0000000000ff', {
      store,
      objects: new FakeObjectStore(),
    });
    expect(await job.start('wf')).toBeNull();
    expect(store.row).toBeNull();
  });

  it('records a failed listing', async () => {
    const store = new MemoryStore();
    const job = createStorageJob(PROJECT, { store, objects: new FakeObjectStore() });
    await job.start('wf');
    await job.fail(new Error('R2 403'));
    expect(store.row).toMatchObject({ status: 'failed', error: 'R2 403' });
  });
});
