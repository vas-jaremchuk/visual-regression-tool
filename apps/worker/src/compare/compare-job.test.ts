import { urlToFilename, type IgnoreRule, type ReportItem } from '@vrt/engine';
import type { DiffMsg, ReviewStatus } from '@vrt/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startFixtureSite, type FixtureSite } from '../test/fixture-site';
import {
  compareEvent,
  createCompareJob,
  diffBatches,
  type CompareProject,
  type CompareRun,
  type CompareRunItem,
  type CompareSettings,
  type CompareStore,
  type ComparisonRow,
  type ItemCounts,
  type NewComparisonItem,
  type ReviewCounts,
} from './compare-job';

const PROJECT = '00000000-0000-0000-0000-0000000000a1';
const BEFORE = '00000000-0000-0000-0000-0000000000b1';
const AFTER = '00000000-0000-0000-0000-0000000000b2';
const CMP = '00000000-0000-0000-0000-0000000000c1';
const BEFORE_LABEL = '2026-11-01_10-00-00';
const AFTER_LABEL = '2026-11-02_10-00-00';
const CMP_LABEL = `${BEFORE_LABEL}_vs_${AFTER_LABEL}`;

type Item = NewComparisonItem & {
  id: string;
  review: ReviewStatus;
  review_note: string | null;
  redirect_to: string | null;
  diff_pct: number | null;
};

/** In-memory `CompareStore`; `refreshCounts` mirrors `refresh_comparison_counts`. */
class MemoryStore implements CompareStore {
  comparison: ComparisonRow & {
    settings: CompareSettings;
    counts: unknown;
    reviewCounts: ReviewCounts;
    reportKey: string | null;
    finishedAt: string | null;
  };
  runs = new Map<string, CompareRun>();
  runItems = new Map<string, CompareRunItem[]>();
  items: Item[] = [];
  rules: IgnoreRule[] = [];
  memory: { url: string; viewport: string | null; sha: string; review: ReviewStatus }[] = [];
  audits: { action: string; details: Record<string, unknown> }[] = [];
  project: CompareProject = {
    id: PROJECT,
    name: 'Fixture',
    bucket: 'vrt-fixture',
    publicUrl: null,
    checkRedirects: true,
    diffThreshold: 0.1,
    changeThresholdPct: 0.05,
    maxPageHeight: 16384,
    basicAuthUser: null,
    basicAuthPassEnc: null,
  };
  private seq = 0;

  constructor() {
    this.comparison = {
      id: CMP,
      projectId: PROJECT,
      label: CMP_LABEL,
      status: 'queued',
      beforeRunId: BEFORE,
      afterRunId: AFTER,
      startedAt: null,
      settings: {} as CompareSettings,
      counts: {},
      reviewCounts: { pending: 0, approved: 0, rejected: 0, ignored: 0 },
      reportKey: null,
      finishedAt: null,
    };
  }

  async loadComparison(id: string) {
    return id === CMP ? { ...this.comparison } : null;
  }
  async loadRun(id: string) {
    return this.runs.get(id) ?? null;
  }
  async loadProject() {
    return this.project;
  }
  async loadIgnoreRules() {
    return this.rules;
  }
  async loadSettings() {
    return this.comparison.settings;
  }
  async updateComparison(_id: string, patch: Parameters<CompareStore['updateComparison']>[1]) {
    if (patch.status) this.comparison.status = patch.status;
    if (patch.settings) this.comparison.settings = patch.settings;
    if (patch.started_at) this.comparison.startedAt = patch.started_at;
    if (patch.finished_at !== undefined) this.comparison.finishedAt = patch.finished_at;
    if (patch.report_r2_key !== undefined) this.comparison.reportKey = patch.report_r2_key;
  }
  async listRunItems(runId: string) {
    return this.runItems.get(runId) ?? [];
  }
  async deleteItems() {
    this.items = [];
  }
  async insertItems(items: NewComparisonItem[]) {
    for (const item of items) {
      this.items.push({
        ...item,
        id: `item-${++this.seq}`,
        review: 'pending',
        review_note: null,
        redirect_to: null,
        diff_pct: null,
      });
    }
  }
  async listPendingPairs() {
    return this.items
      .filter((i) => i.kind === 'page' && i.status === 'pending')
      .map((i) => ({ id: i.id, url: i.url }));
  }
  async markRedirect(_id: string, url: string, to: string) {
    for (const i of this.items) {
      if (i.url === url && i.status === 'pending')
        Object.assign(i, { status: 'redirect', redirect_to: to });
    }
  }
  async failPending(_id: string, error: string) {
    for (const i of this.items)
      if (i.status === 'pending') Object.assign(i, { status: 'error', error });
  }
  async listUnreviewedChanged() {
    return this.items
      .filter((i) => i.status === 'changed' && i.review === 'pending')
      .map((i) => ({ id: i.id, url: i.url, viewportSlug: i.viewport_slug, afterKey: i.after_key }));
  }
  async findReviewMemory(_p: string, url: string, viewport: string | null, sha: string) {
    return (
      this.memory.find((m) => m.url === url && m.viewport === viewport && m.sha === sha)?.review ??
      null
    );
  }
  async setReview(ids: string[], review: ReviewStatus, note: string) {
    for (const i of this.items)
      if (ids.includes(i.id)) Object.assign(i, { review, review_note: note });
  }
  async listReportItems() {
    return this.items as unknown as ReportItem[];
  }
  async refreshCounts() {
    const pages = this.items.filter((i) => i.kind === 'page');
    const tally = (list: Item[]) => ({
      compared: list.filter((i) => ['changed', 'unchanged', 'error'].includes(i.status)).length,
      changed: list.filter((i) => i.status === 'changed').length,
      unchanged: list.filter((i) => i.status === 'unchanged').length,
      new: list.filter((i) => i.status === 'new').length,
      missing: list.filter((i) => i.status === 'missing').length,
      redirect: list.filter((i) => i.status === 'redirect').length,
      error: list.filter((i) => i.status === 'error').length,
    });
    const files = this.items.filter((i) => i.kind === 'file');
    const viewports = [...new Set(pages.map((i) => i.viewport_slug!))];
    this.comparison.counts = {
      ...tally(pages),
      files_changed: files.filter((i) => i.status === 'changed').length,
      files_total: files.length,
      viewports: Object.fromEntries(
        viewports.map((v) => [v, tally(pages.filter((i) => i.viewport_slug === v))]),
      ),
    };
    const changed = this.items.filter((i) => i.status === 'changed');
    this.comparison.reviewCounts = {
      pending: changed.filter((i) => i.review === 'pending').length,
      approved: changed.filter((i) => i.review === 'approved').length,
      rejected: changed.filter((i) => i.review === 'rejected').length,
      ignored: changed.filter((i) => i.review === 'ignored').length,
    };
  }
  async loadCounts() {
    return { counts: this.comparison.counts as ItemCounts, review: this.comparison.reviewCounts };
  }
  async audit(action: string, _p: string, details: Record<string, unknown>) {
    this.audits.push({ action, details });
  }
}

function run(
  id: string,
  label: string,
  viewports: string[],
  extra: Partial<CompareRun> = {},
): CompareRun {
  return {
    id,
    projectId: PROJECT,
    label,
    status: 'completed',
    isLegacy: false,
    viewportSlugs: viewports,
    ...extra,
  };
}

function page(
  url: string,
  viewport: string | null,
  extra: Partial<CompareRunItem> = {},
): CompareRunItem {
  return {
    url,
    kind: 'page',
    viewport_slug: viewport,
    filename: urlToFilename(url),
    status: 'done',
    r2_key: null,
    sha256: null,
    bytes: null,
    http_status: 200,
    content_type: null,
    last_modified: null,
    etag: null,
    final_url: null,
    error: null,
    ...extra,
  };
}

function file(url: string, sha256: string): CompareRunItem {
  return { ...page(url, null), kind: 'file', filename: urlToFilename(url), sha256, bytes: 1234 };
}

/** Plays the diff consumer: each enqueued pair gets the result of `changedUrls`. */
function diffAll(store: MemoryStore, changedUrls: Set<string>) {
  for (const item of store.items) {
    if (item.status !== 'pending') continue;
    const changed = item.url !== null && changedUrls.has(item.url);
    Object.assign(item, { status: changed ? 'changed' : 'unchanged', diff_pct: changed ? 2.5 : 0 });
  }
}

let site: FixtureSite;
beforeAll(async () => {
  site = await startFixtureSite();
});
afterAll(async () => {
  await site.close();
});

function deps(store: MemoryStore, extra: { enqueued?: DiffMsg[]; reports?: string[] } = {}) {
  return {
    store,
    fetcher: fetch,
    basicAuthHeader: async () => null,
    enqueue: async (messages: DiffMsg[]) => {
      extra.enqueued?.push(...messages);
    },
    putReport: async (_bucket: string, key: string) => {
      extra.reports?.push(key);
    },
    notifier: { notify: vi.fn(async () => {}) },
    now: () => new Date('2026-11-22T10:00:00Z'),
  };
}

async function runAll(store: MemoryStore, changedUrls: Set<string>, d = deps(store)) {
  const job = createCompareJob(CMP, d);
  expect(await job.prepare()).toEqual({ skip: false });
  await job.matrix();
  await job.redirects();
  await job.enqueue();
  diffAll(store, changedUrls);
  expect((await job.poll()).settled).toBe(true);
  await job.autoReview();
  await job.export();
  return { job, deps: d, result: await job.finalise() };
}

/** Fixture site v1 (before) and v2 (after): see fixtures/README.md. */
function fixtureRuns(store: MemoryStore, viewports = ['desktop']) {
  const o = site.origin;
  store.runs.set(BEFORE, run(BEFORE, BEFORE_LABEL, viewports));
  store.runs.set(AFTER, run(AFTER, AFTER_LABEL, viewports));
  const v1 = [`${o}/`, `${o}/about/`, `${o}/blog/post-1/?a=1&b=2`, `${o}/old-page/`];
  const v2 = [`${o}/`, `${o}/about/`, `${o}/old-page/`, `${o}/contact/`];
  store.runItems.set(BEFORE, [
    ...viewports.flatMap((v) => v1.map((u) => page(u, v))),
    file(`${o}/docs/brochure.pdf`, 'a'.repeat(64)),
  ]);
  store.runItems.set(AFTER, [
    ...viewports.flatMap((v) => v2.map((u) => page(u, v, { sha256: `${v}:${u}` }))),
    file(`${o}/docs/brochure.pdf`, 'b'.repeat(64)),
  ]);
  return { changed: new Set([`${o}/`, `${o}/about/`]) };
}

describe('CompareJob on fixture site v1 → v2', () => {
  it('reports changed (heading, image), new, missing, redirect and file changed with counts', async () => {
    const store = new MemoryStore();
    const { changed } = fixtureRuns(store);
    const enqueued: DiffMsg[] = [];
    const { result, deps: d } = await runAll(store, changed, deps(store, { enqueued }));

    const byStatus = (s: string) =>
      store.items
        .filter((i) => i.status === s)
        .map((i) => i.url)
        .sort();
    const o = site.origin;
    expect(byStatus('changed')).toEqual([`${o}/`, `${o}/about/`, `${o}/docs/brochure.pdf`]);
    expect(byStatus('new')).toEqual([`${o}/contact/`]);
    expect(byStatus('missing')).toEqual([`${o}/blog/post-1/?a=1&b=2`]);
    expect(store.items.find((i) => i.status === 'redirect')).toMatchObject({
      url: `${o}/old-page/`,
      redirect_to: `${o}/about/`,
    });
    // The redirected page is not diffed: only home and about went to vrt-diff.
    expect(enqueued.flatMap((m) => m.itemIds)).toHaveLength(2);

    expect(store.comparison.counts).toEqual({
      compared: 2,
      changed: 2,
      unchanged: 0,
      new: 1,
      missing: 1,
      redirect: 1,
      error: 0,
      files_changed: 1,
      files_total: 1,
      viewports: {
        desktop: {
          compared: 2,
          changed: 2,
          unchanged: 0,
          new: 1,
          missing: 1,
          redirect: 1,
          error: 0,
        },
      },
    });
    const pdf = store.items.find((i) => i.kind === 'file')!;
    expect(pdf.fp_before).toMatchObject({ sha256: 'a'.repeat(64), size: 1234 });
    expect(pdf.fp_after).toMatchObject({ sha256: 'b'.repeat(64) });

    expect(result).toEqual({ status: 'completed', event: 'comparison_changed' });
    expect(store.comparison.status).toBe('completed');
    expect(d.notifier.notify).toHaveBeenCalledWith('comparison_changed', {
      projectId: PROJECT,
      comparisonId: CMP,
      label: CMP_LABEL,
    });
    expect(store.audits.map((a) => a.action)).toEqual(['comparison.completed']);
  });

  it('builds object keys from the run layout and diff keys from the comparison label', async () => {
    const store = new MemoryStore();
    fixtureRuns(store);
    const job = createCompareJob(CMP, deps(store));
    await job.prepare();
    await job.matrix();
    const home = store.items.find((i) => i.url === `${site.origin}/` && i.kind === 'page')!;
    const name = urlToFilename(`${site.origin}/`).replace(/\.png$/, '');
    expect(home).toMatchObject({
      status: 'pending',
      before_key: `screenshots/${BEFORE_LABEL}/desktop/${name}.png`,
      after_key: `screenshots/${AFTER_LABEL}/desktop/${name}.png`,
      diff_key: `diffs/${CMP_LABEL}/desktop/${name}.png`,
    });
  });

  it('reports a viewport present in one run only as info, not as an error', async () => {
    const store = new MemoryStore();
    const { changed } = fixtureRuns(store);
    const after = store.runItems.get(AFTER)!;
    store.runs.set(AFTER, run(AFTER, AFTER_LABEL, ['desktop', 'mobile']));
    store.runItems.set(AFTER, [...after, page(`${site.origin}/`, 'mobile')]);
    await runAll(store, changed);

    expect(store.comparison.settings).toMatchObject({
      viewports: ['desktop'],
      viewportsNotInBefore: ['mobile'],
      viewportsNotInAfter: [],
    });
    expect(store.items.some((i) => i.viewport_slug === 'mobile')).toBe(false);
    expect(store.items.filter((i) => i.status === 'error')).toEqual([]);
    expect(store.comparison.status).toBe('completed');
  });

  it('replaces the items when the same pair is re-run', async () => {
    const store = new MemoryStore();
    const { changed } = fixtureRuns(store);
    await runAll(store, changed);
    const first = store.items.map((i) => i.id);

    store.comparison.status = 'queued';
    await runAll(store, new Set());
    expect(store.items).toHaveLength(first.length);
    expect(store.items.some((i) => first.includes(i.id))).toBe(false);
    expect(store.comparison.counts).toMatchObject({ changed: 0, unchanged: 2, files_changed: 1 });
  });

  it('compares legacy run items without a viewport against desktop', async () => {
    const store = new MemoryStore();
    const o = site.origin;
    store.runs.set(BEFORE, run(BEFORE, BEFORE_LABEL, [], { isLegacy: true }));
    store.runs.set(AFTER, run(AFTER, AFTER_LABEL, ['desktop', 'mobile']));
    store.runItems.set(BEFORE, [page(`${o}/`, null), page(`${o}/about/`, null)]);
    store.runItems.set(AFTER, [
      page(`${o}/`, 'desktop'),
      page(`${o}/about/`, 'desktop'),
      page(`${o}/`, 'mobile'),
    ]);
    const job = createCompareJob(CMP, deps(store));
    await job.prepare();
    expect(await job.matrix()).toMatchObject({ items: 2, pending: 2, viewports: ['desktop'] });
    const name = urlToFilename(`${o}/`).replace(/\.png$/, '');
    expect(store.items.find((i) => i.url === `${o}/`)).toMatchObject({
      viewport_slug: 'desktop',
      before_key: `screenshots/${BEFORE_LABEL}/${name}.png`,
      after_key: `screenshots/${AFTER_LABEL}/desktop/${name}.png`,
    });
    expect(store.comparison.settings.viewportsNotInBefore).toEqual(['mobile']);
  });
});

describe('CompareJob steps', () => {
  it('skips the redirect check when the project disabled it', async () => {
    const store = new MemoryStore();
    store.project = { ...store.project, checkRedirects: false };
    const { changed } = fixtureRuns(store);
    await runAll(store, changed);
    expect(store.items.find((i) => i.url === `${site.origin}/old-page/`)?.status).toBe('unchanged');
  });

  it('fails when a run has not completed', async () => {
    const store = new MemoryStore();
    fixtureRuns(store);
    store.runs.set(AFTER, { ...store.runs.get(AFTER)!, status: 'running' });
    const job = createCompareJob(CMP, deps(store));
    await expect(job.prepare()).rejects.toThrow(/after run .* is running/);
    store.comparison.status = 'running';
    await job.fail(new Error('boom'));
    expect(store.comparison.status).toBe('failed');
    expect(store.audits.at(-1)).toMatchObject({ action: 'comparison.failed' });
  });

  it('skips a comparison that is already final', async () => {
    const store = new MemoryStore();
    store.comparison.status = 'completed';
    expect(await createCompareJob(CMP, deps(store)).prepare()).toEqual({ skip: true });
  });

  it('auto-reviews ignored URLs and remembered after PNGs, then reports clean', async () => {
    const store = new MemoryStore();
    const { changed } = fixtureRuns(store);
    const o = site.origin;
    store.rules = [{ type: 'url_pattern', url_pattern: `${o}/about/`, applies_to: 'compare' }];
    store.memory = [
      { url: `${o}/`, viewport: 'desktop', sha: `desktop:${o}/`, review: 'approved' },
    ];
    store.runItems.set(
      AFTER,
      store.runItems
        .get(AFTER)!
        .map((i) => (i.kind === 'file' ? { ...i, sha256: 'a'.repeat(64) } : i)),
    );
    const { result } = await runAll(store, changed);
    expect(store.items.find((i) => i.url === `${o}/about/`)).toMatchObject({
      review: 'ignored',
      review_note: 'auto: ignore rule',
    });
    expect(store.items.find((i) => i.url === `${o}/`)).toMatchObject({ review: 'approved' });
    expect(result.event).toBe('comparison_clean');
  });

  it('exports the static report only when the project has a public URL', async () => {
    const without = new MemoryStore();
    const reports: string[] = [];
    await runAll(without, fixtureRuns(without).changed, deps(without, { reports }));
    expect(reports).toEqual([]);

    const store = new MemoryStore();
    store.project = { ...store.project, publicUrl: 'https://cdn.example.test' };
    await runAll(store, fixtureRuns(store).changed, deps(store, { reports }));
    expect(reports).toEqual([`reports/${CMP_LABEL}/index.html`]);
    expect(store.comparison.reportKey).toBe(`reports/${CMP_LABEL}/index.html`);
  });

  it('marks pairs still waiting as errors on timeout', async () => {
    const store = new MemoryStore();
    fixtureRuns(store);
    const job = createCompareJob(CMP, deps(store));
    await job.prepare();
    await job.matrix();
    await job.timeout();
    expect(store.items.filter((i) => i.status === 'pending')).toEqual([]);
    expect(store.items.filter((i) => i.error === 'timeout').length).toBeGreaterThan(0);
  });
});

describe('helpers', () => {
  it('batches pending pairs five per message', () => {
    const pairs = Array.from({ length: 12 }, (_, i) => ({
      id: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
      url: 'u',
    }));
    expect(diffBatches(CMP, pairs).map((m) => m.itemIds.length)).toEqual([5, 5, 2]);
  });

  it('notifies changed for open or rejected changes and for file changes', () => {
    expect(compareEvent({ files_changed: 0 }, { pending: 0, rejected: 0 })).toBe(
      'comparison_clean',
    );
    expect(compareEvent({ files_changed: 0 }, { pending: 0, rejected: 1 })).toBe(
      'comparison_changed',
    );
    expect(compareEvent({ files_changed: 1 }, { pending: 0, rejected: 0 })).toBe(
      'comparison_changed',
    );
  });
});
