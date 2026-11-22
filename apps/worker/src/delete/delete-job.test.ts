import type { Json } from '@vrt/db';
import type { ComparisonStatus, RunStatus } from '@vrt/shared';
import { FakeObjectStore } from '@vrt/storage/testing';
import { describe, expect, it } from 'vitest';
import { BaselineRunError, createDeleteJob, type DeleteStore } from './delete-job';

const PROJECT = '00000000-0000-0000-0000-0000000000a1';
const RUN_A = '00000000-0000-0000-0000-0000000000b1';
const RUN_B = '00000000-0000-0000-0000-0000000000b2';
const RUN_C = '00000000-0000-0000-0000-0000000000b3';
const CMP_AB = '00000000-0000-0000-0000-0000000000c1';
const CMP_BC = '00000000-0000-0000-0000-0000000000c2';
const A = '2026-11-01_10-00-00';
const B = '2026-11-02_10-00-00';
const C = '2026-11-03_10-00-00';
const BUCKET = 'vrt-fixture';

interface Run {
  id: string;
  label: string;
  status: RunStatus;
}
interface Comparison {
  id: string;
  label: string;
  before: string;
  after: string;
  status: ComparisonStatus;
}

class MemoryStore implements DeleteStore {
  project: { id: string; bucket: string; baseline: string | null } | null = {
    id: PROJECT,
    bucket: BUCKET,
    baseline: null,
  };
  runs: Run[] = [
    { id: RUN_A, label: A, status: 'completed' },
    { id: RUN_B, label: B, status: 'completed' },
    { id: RUN_C, label: C, status: 'completed' },
  ];
  comparisons: Comparison[] = [
    { id: CMP_AB, label: `${A}_vs_${B}`, before: RUN_A, after: RUN_B, status: 'completed' },
    { id: CMP_BC, label: `${B}_vs_${C}`, before: RUN_B, after: RUN_C, status: 'completed' },
  ];
  audits: { action: string; details: Record<string, Json> }[] = [];

  async loadRun(runId: string) {
    const run = this.runs.find((r) => r.id === runId);
    if (!run || !this.project) return null;
    return {
      id: run.id,
      projectId: PROJECT,
      label: run.label,
      bucket: BUCKET,
      isBaseline: this.project.baseline === run.id,
    };
  }
  async loadComparison(id: string) {
    const c = this.comparisons.find((x) => x.id === id);
    return c ? { id, projectId: PROJECT, label: c.label, bucket: BUCKET } : null;
  }
  async loadProject() {
    return this.project ? { id: PROJECT, bucket: BUCKET } : null;
  }
  async comparisonsOfRun(runId: string) {
    return this.comparisons.filter((c) => c.before === runId || c.after === runId);
  }
  async runsOfProject() {
    return this.runs;
  }
  async comparisonsOfProject() {
    return this.comparisons;
  }
  async setRunStatus(runId: string, status: RunStatus) {
    this.runs.find((r) => r.id === runId)!.status = status;
  }
  async setComparisonStatus(ids: string[], status: ComparisonStatus) {
    for (const c of this.comparisons) if (ids.includes(c.id)) c.status = status;
  }
  async deleteComparisons(ids: string[]) {
    this.comparisons = this.comparisons.filter((c) => !ids.includes(c.id));
  }
  async deleteRun(runId: string) {
    this.runs = this.runs.filter((r) => r.id !== runId);
    this.comparisons = this.comparisons.filter((c) => c.before !== runId && c.after !== runId);
  }
  async deleteProject() {
    this.project = null;
    this.runs = [];
    this.comparisons = [];
  }
  async audit(action: string, _projectId: string, details: Record<string, Json>) {
    this.audits.push({ action, details });
  }
}

/** Fixture bucket: three runs, two comparisons (diffs + report) and an unrelated probe object. */
async function fixtureBucket(): Promise<FakeObjectStore> {
  const objects = new FakeObjectStore();
  const put = (key: string) => objects.put(BUCKET, key, new Uint8Array(10), 'image/png');
  for (const label of [A, B, C]) {
    await put(`screenshots/${label}/desktop/home.png`);
    await put(`screenshots/${label}/mobile/home.png`);
    await put(`screenshots/${label}/_files/doc.pdf.txt`);
  }
  for (const cmp of [`${A}_vs_${B}`, `${B}_vs_${C}`]) {
    await put(`diffs/${cmp}/desktop/home.png`);
    await put(`reports/${cmp}/index.html`);
  }
  await put('_vrt/probe.txt');
  return objects;
}

function keys(objects: FakeObjectStore): string[] {
  return [...(objects.buckets.get(BUCKET)?.keys() ?? [])].sort();
}

async function runAll(job: ReturnType<typeof createDeleteJob>) {
  const plan = await job.plan();
  if (plan.skip) return plan;
  const { objects } = await job.deleteObjects(plan);
  await job.deleteRows(plan, objects);
  return plan;
}

describe('DeleteJob: run', () => {
  it('removes screenshots/<label>/, the diffs and reports of dependent comparisons and their rows', async () => {
    const store = new MemoryStore();
    const objects = await fixtureBucket();
    const job = createDeleteJob({ entity: 'run', id: RUN_B }, { store, objects });

    const plan = await job.plan();
    expect(plan.comparisonIds.sort()).toEqual([CMP_AB, CMP_BC]);
    expect(store.runs.find((r) => r.id === RUN_B)?.status).toBe('deleting');
    expect(store.comparisons.map((c) => c.status)).toEqual(['deleting', 'deleting']);

    const { objects: deleted } = await job.deleteObjects(plan);
    await job.deleteRows(plan, deleted);

    expect(deleted).toBe(7);
    expect(keys(objects)).toEqual([
      '_vrt/probe.txt',
      `screenshots/${A}/_files/doc.pdf.txt`,
      `screenshots/${A}/desktop/home.png`,
      `screenshots/${A}/mobile/home.png`,
      `screenshots/${C}/_files/doc.pdf.txt`,
      `screenshots/${C}/desktop/home.png`,
      `screenshots/${C}/mobile/home.png`,
    ]);
    expect(store.runs.map((r) => r.id)).toEqual([RUN_A, RUN_C]);
    expect(store.comparisons).toEqual([]);
    expect(store.audits).toEqual([
      {
        action: 'run.deleted',
        details: { runId: RUN_B, label: B, comparisons: [CMP_AB, CMP_BC], objects: 7 },
      },
    ]);
  });

  it('refuses the baseline run and leaves its status and objects alone', async () => {
    const store = new MemoryStore();
    store.project!.baseline = RUN_A;
    const objects = await fixtureBucket();
    const before = keys(objects);
    const job = createDeleteJob({ entity: 'run', id: RUN_A }, { store, objects });

    const error = await job.plan().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BaselineRunError);
    await job.fail(error);

    expect(store.runs.find((r) => r.id === RUN_A)?.status).toBe('completed');
    expect(keys(objects)).toEqual(before);
    expect(store.audits.map((a) => a.action)).toEqual(['run.delete_failed']);
  });

  it('keeps the rows as delete_failed when R2 fails, and a retry finishes the job', async () => {
    const store = new MemoryStore();
    const objects = await fixtureBucket();
    const failing = {
      list: objects.list.bind(objects),
      delete: async () => {
        throw new Error('R2 503');
      },
    };
    const job = createDeleteJob({ entity: 'run', id: RUN_C }, { store, objects: failing });
    const plan = await job.plan();
    const error = await job.deleteObjects(plan).catch((e: unknown) => e);
    await job.fail(error);

    expect(store.runs.find((r) => r.id === RUN_C)?.status).toBe('delete_failed');
    expect(store.comparisons.find((c) => c.id === CMP_BC)?.status).toBe('delete_failed');
    expect(store.audits.at(-1)).toEqual({
      action: 'run.delete_failed',
      details: { runId: RUN_C, error: 'R2 503' },
    });

    await runAll(createDeleteJob({ entity: 'run', id: RUN_C }, { store, objects }));
    expect(store.runs.map((r) => r.id)).toEqual([RUN_A, RUN_B]);
    expect(keys(objects).some((k) => k.includes(C))).toBe(false);
  });

  it('skips a run that is already gone', async () => {
    const store = new MemoryStore();
    const plan = await createDeleteJob(
      { entity: 'run', id: '00000000-0000-0000-0000-0000000000ff' },
      { store, objects: new FakeObjectStore() },
    ).plan();
    expect(plan.skip).toBe(true);
  });
});

describe('DeleteJob: comparison', () => {
  it('removes the diffs and report of the comparison only', async () => {
    const store = new MemoryStore();
    const objects = await fixtureBucket();
    await runAll(createDeleteJob({ entity: 'comparison', id: CMP_AB }, { store, objects }));

    expect(keys(objects).filter((k) => !k.startsWith('screenshots/'))).toEqual([
      '_vrt/probe.txt',
      `diffs/${B}_vs_${C}/desktop/home.png`,
      `reports/${B}_vs_${C}/index.html`,
    ]);
    expect(store.comparisons.map((c) => c.id)).toEqual([CMP_BC]);
    expect(store.runs).toHaveLength(3);
  });
});

describe('DeleteJob: project', () => {
  it('removes the objects of every run and comparison, then the project', async () => {
    const store = new MemoryStore();
    store.project!.baseline = RUN_A;
    const objects = await fixtureBucket();
    await runAll(createDeleteJob({ entity: 'project', id: PROJECT }, { store, objects }));

    expect(keys(objects)).toEqual(['_vrt/probe.txt']);
    expect(store.project).toBeNull();
    expect(store.audits.map((a) => a.action)).toEqual(['project.deleted']);
  });
});
