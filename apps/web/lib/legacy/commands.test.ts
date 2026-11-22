import { describe, expect, it } from 'vitest';
import { ForbiddenError } from '../auth/assert-can';
import { RequestError } from '../members/errors';
import { createLegacyCommands, type LegacyGateway } from './commands';

const PROJECT = '11111111-1111-4111-8111-111111111111';
const BUCKET = 'vrt-test';

/** Bucket keys: two prototype runs, one new-layout run, one imported prototype run. */
const KEYS = [
  'screenshots/2026-08-07_10-00-00/index.png',
  'screenshots/2026-08-07_10-00-00/docs_brochure.pdf.txt',
  'screenshots/2026-08-08_09-30-00/index.png',
  'screenshots/2026-08-01_08-00-00/index.png',
  'screenshots/2026-11-20_12-00-00/desktop/index.png',
  'screenshots/2026-11-20_12-00-00/_files/docs_brochure.pdf.txt',
  'screenshots/not-a-run/index.png',
  'diffs/x/desktop/index.png',
];

function setup(opts: { allowed?: boolean; archived?: boolean } = {}) {
  const started: string[][] = [];
  const audits: { action: string; details: unknown }[] = [];
  const db: LegacyGateway = {
    loadProject: async (id) =>
      id === PROJECT ? { id, r2Bucket: BUCKET, archived: opts.archived ?? false } : null,
    runLabels: async () => ['2026-08-01_08-00-00', '2026-11-20_12-00-00'],
    listPrefixes: async (bucket, prefix) => {
      expect(bucket).toBe(BUCKET);
      const out = new Set<string>();
      for (const key of KEYS) {
        if (!key.startsWith(prefix)) continue;
        const at = key.indexOf('/', prefix.length);
        if (at !== -1) out.add(key.slice(0, at + 1));
      }
      return [...out];
    },
    startImport: async (_projectId, labels) => {
      started.push(labels);
      return { workflowId: 'wf-1' };
    },
    audit: async (action, _projectId, details) => {
      audits.push({ action, details });
    },
  };
  const commands = createLegacyCommands({
    authorize: async () => {
      if (opts.allowed === false) throw new ForbiddenError('legacy.import');
    },
    db,
  });
  return { commands, started, audits };
}

describe('legacy import commands', () => {
  it('lists prototype-layout prefixes that have no run yet', async () => {
    const { commands } = setup();
    expect(await commands.listLabels(PROJECT)).toEqual({
      labels: ['2026-08-07_10-00-00', '2026-08-08_09-30-00'],
    });
  });

  it('starts the import workflow for the selected labels and audits it', async () => {
    const { commands, started, audits } = setup();
    const result = await commands.importLabels(PROJECT, [
      '2026-08-08_09-30-00',
      '2026-08-07_10-00-00',
      '2026-08-07_10-00-00',
    ]);
    expect(result).toEqual({ workflowId: 'wf-1' });
    expect(started).toEqual([['2026-08-07_10-00-00', '2026-08-08_09-30-00']]);
    expect(audits).toEqual([
      {
        action: 'run.import_legacy',
        details: { labels: ['2026-08-07_10-00-00', '2026-08-08_09-30-00'], workflow_id: 'wf-1' },
      },
    ]);
  });

  it.each([['2026-08-01_08-00-00'], ['2026-11-20_12-00-00'], ['2026-01-01_00-00-00']])(
    'refuses %s (already imported, new layout or not in the bucket)',
    async (label) => {
      const { commands, started } = setup();
      await expect(commands.importLabels(PROJECT, [label])).rejects.toMatchObject({
        status: 422,
        details: { labels: [label] },
      });
      expect(started).toEqual([]);
    },
  );

  it('refuses an archived project', async () => {
    const { commands } = setup({ archived: true });
    await expect(commands.importLabels(PROJECT, ['2026-08-07_10-00-00'])).rejects.toMatchObject({
      status: 422,
    });
  });

  it('requires project admin rights and an existing project', async () => {
    await expect(setup({ allowed: false }).commands.listLabels(PROJECT)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const missing = setup().commands.listLabels('22222222-2222-4222-8222-222222222222');
    await expect(missing).rejects.toBeInstanceOf(RequestError);
  });
});
