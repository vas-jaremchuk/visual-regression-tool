import { describe, expect, it } from 'vitest';
import { formatBytes, retentionProposals, storageGroupOf, summarizeStorage } from './storage-usage';

describe('summarizeStorage', () => {
  it('totals bytes and objects per top-level prefix, other keys as other', () => {
    const usage = summarizeStorage([
      { key: 'screenshots/2026-11-01_10-00-00/desktop/home.png', size: 100 },
      { key: 'screenshots/2026-11-01_10-00-00/_files/doc.txt', size: 5 },
      { key: 'diffs/2026-11-01_10-00-00_vs_2026-11-02_10-00-00/desktop/home.png', size: 40 },
      { key: 'reports/2026-11-01_10-00-00_vs_2026-11-02_10-00-00/index.html', size: 7 },
      { key: '_vrt/probe.txt', size: 2 },
      { key: 'screenshots-old.png', size: 1 },
    ]);
    expect(usage).toEqual({
      totalBytes: 155,
      objectCount: 6,
      groups: [
        { prefix: 'screenshots', bytes: 105, objects: 2 },
        { prefix: 'diffs', bytes: 40, objects: 1 },
        { prefix: 'reports', bytes: 7, objects: 1 },
        { prefix: 'other', bytes: 3, objects: 2 },
      ],
    });
  });

  it('reports every group for an empty bucket', () => {
    const usage = summarizeStorage([]);
    expect(usage.totalBytes).toBe(0);
    expect(usage.groups.map((g) => [g.prefix, g.bytes, g.objects])).toEqual([
      ['screenshots', 0, 0],
      ['diffs', 0, 0],
      ['reports', 0, 0],
      ['other', 0, 0],
    ]);
  });

  it('groups by prefix only', () => {
    expect(storageGroupOf('screenshots/x')).toBe('screenshots');
    expect(storageGroupOf('diffs')).toBe('other');
  });
});

describe('formatBytes', () => {
  it('matches prototype storage.js fmt()', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 ** 2)).toBe('5.0 MB');
    expect(formatBytes(10 * 1024 ** 3)).toBe('10.00 GB');
  });
});

describe('retentionProposals', () => {
  const run = (label: string, isBaseline = false) => ({ id: label, label, isBaseline });

  it('proposes runs older than the newest N non-baseline runs, never the baseline', () => {
    const runs = [
      run('2026-11-01_10-00-00', true),
      run('2026-11-04_10-00-00'),
      run('2026-11-02_10-00-00'),
      run('2026-11-03_10-00-00'),
      run('2026-11-05_10-00-00'),
    ];
    expect(retentionProposals(runs, 2).map((r) => r.label)).toEqual([
      '2026-11-03_10-00-00',
      '2026-11-02_10-00-00',
    ]);
  });

  it('proposes nothing when there are at most N runs', () => {
    expect(retentionProposals([run('2026-11-01_10-00-00')], 1)).toEqual([]);
  });
});
