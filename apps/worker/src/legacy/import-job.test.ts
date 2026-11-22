import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assignFilenames,
  buildComparisonMatrix,
  type LegacyRunItem,
  type MatrixRunItem,
} from '@vrt/engine';
import { diffImages } from '@vrt/engine/diff';
import { legacyRunLabels, screenshotKey, type ItemStatus } from '@vrt/shared';
import { FakeObjectStore } from '@vrt/storage/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createImportJob,
  labelTime,
  type ExistingRun,
  type ImportStore,
  type LegacyRunPatch,
} from './import-job';

const PROJECT_ID = '0b7f3c2e-1a2b-4c3d-8e9f-0a1b2c3d4e5f';
const BUCKET = 'vrt-legacy-fixture';
const BUCKET_DIR = fileURLToPath(
  new URL('../../../../fixtures/legacy-bucket', import.meta.url).href,
);
const NOW = new Date('2026-11-22T08:00:00.000Z');

/** Latest snapshot of the project: the fixture site's pages and PDF on example.com. */
const SNAPSHOT_URLS = [
  { url: 'https://example.com/', kind: 'page', included: true },
  { url: 'https://example.com/about/', kind: 'page', included: true },
  { url: 'https://example.com/blog/post-1/?a=1&b=2', kind: 'page', included: true },
  { url: 'https://example.com/old-page/', kind: 'page', included: false },
  { url: 'https://example.com/docs/brochure.pdf', kind: 'file', included: true },
] as const;

/** Loads `fixtures/legacy-bucket` (prototype bucket layout) into a fake object store. */
async function fixtureBucket(): Promise<FakeObjectStore> {
  const store = new FakeObjectStore();
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else {
        const key = relative(BUCKET_DIR, path).split(sep).join('/');
        const type = key.endsWith('.png') ? 'image/png' : 'text/plain';
        await store.put(BUCKET, key, new Uint8Array(await readFile(path)), type);
      }
    }
  }
  await walk(BUCKET_DIR);
  return store;
}

interface MemoryRun {
  id: string;
  label: string;
  isLegacy: boolean;
  status: string;
  startedAt: string | null;
  patch?: LegacyRunPatch;
  items: (LegacyRunItem & { status: ItemStatus; finished_at: string })[];
  counted: boolean;
}

function memoryStore(
  snapshotUrls: readonly { url: string; kind: 'page' | 'file'; included: boolean }[],
) {
  const runs: MemoryRun[] = [];
  const store: ImportStore = {
    loadProject: async (id) =>
      id === PROJECT_ID ? { id, r2Bucket: BUCKET, fileExtensions: null } : null,
    findRun: async (_projectId, label): Promise<ExistingRun | null> => {
      const run = runs.find((r) => r.label === label);
      return run ? { id: run.id, isLegacy: run.isLegacy, status: run.status } : null;
    },
    latestSnapshotUrls: async () => [...snapshotUrls],
    createRun: async (run) => {
      const id = `run-${runs.length + 1}`;
      runs.push({
        id,
        label: run.label,
        isLegacy: true,
        status: 'running',
        startedAt: run.startedAt,
        items: [],
        counted: false,
      });
      return { id };
    },
    deleteItems: async (runId) => {
      runs.find((r) => r.id === runId)!.items = [];
    },
    insertItems: async (runId, items, finishedAt) => {
      const run = runs.find((r) => r.id === runId)!;
      run.items.push(
        ...items.map((i) => ({ ...i, status: 'done' as const, finished_at: finishedAt })),
      );
    },
    updateRun: async (runId, patch) => {
      const run = runs.find((r) => r.id === runId)!;
      run.status = patch.status;
      run.patch = patch;
    },
    refreshCounts: async (runId) => {
      runs.find((r) => r.id === runId)!.counted = true;
    },
  };
  return { store, runs };
}

describe('legacy import of fixtures/legacy-bucket', () => {
  let objects: FakeObjectStore;

  beforeEach(async () => {
    objects = await fixtureBucket();
  });

  it('lists only the prefixes in prototype layout', async () => {
    const keys: string[] = [];
    for await (const { key } of objects.list(BUCKET, 'screenshots/')) keys.push(key);
    expect(legacyRunLabels(keys)).toEqual(['2026-08-07_10-00-00', '2026-08-08_09-30-00']);
  });

  it('imports a prototype run with the right counts, URLs and fingerprints', async () => {
    const { store, runs } = memoryStore(SNAPSHOT_URLS);
    const job = createImportJob(PROJECT_ID, { store, objects, now: () => NOW });

    const result = await job.importLabel('2026-08-07_10-00-00');

    // 4 page screenshots, 1 fingerprint; the legacy screenshot of the PDF link is ignored.
    expect(result).toEqual({
      label: '2026-08-07_10-00-00',
      imported: true,
      runId: 'run-1',
      pages: 4,
      files: 1,
      skipped: 1,
    });
    const run = runs[0]!;
    expect(run).toMatchObject({
      isLegacy: true,
      status: 'completed',
      startedAt: '2026-08-07T10:00:00.000Z',
      counted: true,
      patch: { viewport_slugs: ['desktop'], finished_at: NOW.toISOString() },
    });
    const byName = Object.fromEntries(run.items.map((i) => [i.filename, i]));
    expect(Object.keys(byName).sort()).toEqual([
      'about_.png',
      'blog_post-1_a_1_b_2.png',
      'docs_brochure.pdf.png',
      'index.png',
      'retired-page_.png',
    ]);
    expect(byName['index.png']).toMatchObject({
      url: 'https://example.com/',
      kind: 'page',
      viewport_slug: 'desktop',
      r2_key: 'screenshots/2026-08-07_10-00-00/index.png',
      status: 'done',
    });
    expect(byName['blog_post-1_a_1_b_2.png']!.url).toBe('https://example.com/blog/post-1/?a=1&b=2');
    // Not in the latest snapshot: the item keeps url = null and is shown by its filename.
    expect(byName['retired-page_.png']!.url).toBeNull();
    expect(byName['docs_brochure.pdf.png']).toEqual({
      url: 'https://example.com/docs/brochure.pdf',
      kind: 'file',
      viewport_slug: null,
      filename: 'docs_brochure.pdf.png',
      r2_key: 'screenshots/2026-08-07_10-00-00/docs_brochure.pdf.txt',
      bytes: 4,
      sha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
      http_status: 200,
      content_type: 'application/pdf',
      last_modified: 'Wed, 05 Aug 2026 10:00:00 GMT',
      etag: '"brochure-v1"',
      final_url: null,
      status: 'done',
      finished_at: NOW.toISOString(),
    });
    for (const item of run.items) {
      expect(await objects.head(BUCKET, item.r2_key)).not.toBeNull();
    }
  });

  it('keeps url = null for every page when the project has no snapshot', async () => {
    const { store, runs } = memoryStore([]);
    await createImportJob(PROJECT_ID, { store, objects }).importLabel('2026-08-08_09-30-00');
    const [page, file] = [...runs[0]!.items].sort((a, b) => a.kind.localeCompare(b.kind)).reverse();
    expect(page).toMatchObject({ filename: 'index.png', url: null });
    expect(file).toMatchObject({
      url: 'https://example.com/docs/brochure.pdf',
      sha256: 'ERROR HTTP 404',
      http_status: 404,
    });
  });

  it('skips a label that already has a finished run and redoes a half-imported one', async () => {
    const { store, runs } = memoryStore(SNAPSHOT_URLS);
    const job = createImportJob(PROJECT_ID, { store, objects });
    await job.importLabel('2026-08-07_10-00-00');
    expect(await job.importLabel('2026-08-07_10-00-00')).toEqual({
      label: '2026-08-07_10-00-00',
      imported: false,
      reason: 'A run with this label already exists',
    });

    runs[0]!.status = 'running';
    const again = await job.importLabel('2026-08-07_10-00-00');
    expect(again).toMatchObject({ imported: true, runId: 'run-1', pages: 4, files: 1 });
    expect(runs).toHaveLength(1);
    expect(runs[0]!.items).toHaveLength(5);
  });

  it('does not create a run for a prefix without legacy objects', async () => {
    const { store, runs } = memoryStore(SNAPSHOT_URLS);
    const result = await createImportJob(PROJECT_ID, { store, objects }).importLabel(
      '2026-11-20_12-00-00',
    );
    expect(result).toEqual({
      label: '2026-11-20_12-00-00',
      imported: false,
      reason: 'No screenshots or fingerprints found',
    });
    expect(runs).toHaveLength(0);
  });

  it('compares the legacy run with a new desktop run without errors', async () => {
    const { store, runs } = memoryStore(SNAPSHOT_URLS);
    await createImportJob(PROJECT_ID, { store, objects }).importLabel('2026-08-07_10-00-00');
    const legacy: (MatrixRunItem & { r2_key: string })[] = runs[0]!.items;

    // A new run captured from the same snapshot (layout `screenshots/<label>/desktop/…`).
    const label = '2026-11-20_12-00-00';
    const pages = assignFilenames(
      SNAPSHOT_URLS.filter((u) => u.kind === 'page' && u.included).map((u) => u.url),
    );
    const current: (MatrixRunItem & { r2_key: string })[] = [
      ...pages.map(({ url, filename }) => ({
        url,
        kind: 'page' as const,
        viewport_slug: 'desktop',
        filename,
        status: 'done' as const,
        r2_key: screenshotKey(label, 'desktop', filename),
      })),
      {
        url: 'https://example.com/docs/brochure.pdf',
        kind: 'file' as const,
        viewport_slug: null,
        filename: 'docs_brochure.pdf.png',
        status: 'done' as const,
        sha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
        r2_key: `screenshots/${label}/_files/docs_brochure.pdf.txt`,
      },
    ];
    for (const page of current.filter((i) => i.kind === 'page')) {
      await objects.put(
        BUCKET,
        page.r2_key,
        await objects.get(BUCKET, `screenshots/${label}/desktop/index.png`),
        'image/png',
      );
    }

    const matrix = buildComparisonMatrix(legacy, current, {
      beforeViewports: ['desktop'],
      afterViewports: ['desktop'],
    });
    expect(matrix.viewports).toEqual(['desktop']);
    expect(matrix.entries.filter((e) => e.status === 'error')).toEqual([]);
    const status = Object.fromEntries(matrix.entries.map((e) => [e.name, e.status]));
    expect(status).toEqual({
      index: 'pending',
      about_: 'pending',
      'blog_post-1_a_1_b_2': 'pending',
      'retired-page_': 'missing',
      'docs_brochure.pdf': 'unchanged',
    });
    expect(matrix.entries.find((e) => e.name === 'retired-page_')!.url).toBeNull();

    // The pixel diff reads both screenshots by their R2 keys.
    for (const entry of matrix.entries.filter((e) => e.status === 'pending')) {
      const before = await objects.get(BUCKET, entry.before!.r2_key);
      const after = await objects.get(BUCKET, entry.after!.r2_key);
      const diff = diffImages(before, after);
      expect(diff.totalPixels).toBeGreaterThan(0);
    }
  });
});

describe('labelTime', () => {
  it('reads the UTC time of a prototype run folder', () => {
    expect(labelTime('2026-08-07_10-00-00')).toBe('2026-08-07T10:00:00.000Z');
    expect(labelTime('2026-08-07_10-00-00-2')).toBe('2026-08-07T10:00:00.000Z');
    expect(labelTime('latest')).toBeNull();
  });
});
