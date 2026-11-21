import { describe, expect, it } from 'vitest';
import {
  buildSnapshotUrls,
  diffSnapshotUrls,
  formatSitemapTxt,
  mergeManualUrls,
  snapshotCounts,
} from './snapshot';
import type { RedirectCheckResult } from './sitemap';

const A = 'https://site.test/a/';
const B = 'https://site.test/b/';
const PDF = 'https://site.test/doc.pdf';

describe('mergeManualUrls', () => {
  it('adds manual URLs not in the sitemap, sorted, keeping the sitemap as source', () => {
    expect(mergeManualUrls([B, A], [A, PDF])).toEqual([
      { url: A, source: 'sitemap' },
      { url: B, source: 'sitemap' },
      { url: PDF, source: 'manual' },
    ]);
  });
});

describe('buildSnapshotUrls and snapshotCounts', () => {
  const checks = new Map<string, RedirectCheckResult>([
    [A, { url: A, httpStatus: 301, redirectTo: B, included: false }],
    [B, { url: B, httpStatus: 404, redirectTo: null, included: true }],
    [PDF, { url: PDF, httpStatus: null, redirectTo: null, included: true, error: 'ECONNRESET' }],
  ]);
  const entries = mergeManualUrls([A, B, PDF], []);

  it('marks redirects excluded with their target, files as files, errors kept', () => {
    const rows = buildSnapshotUrls(entries, { checks });
    expect(rows).toEqual([
      { url: A, kind: 'page', httpStatus: 301, redirectTo: B, included: false, source: 'sitemap' },
      {
        url: B,
        kind: 'page',
        httpStatus: 404,
        redirectTo: null,
        included: true,
        source: 'sitemap',
      },
      {
        url: PDF,
        kind: 'file',
        httpStatus: null,
        redirectTo: null,
        included: true,
        source: 'sitemap',
      },
    ]);
    expect(snapshotCounts(rows, true)).toEqual({ urlCount: 2, redirectCount: 1, errorCount: 2 });
  });

  it('applies url_pattern rules for capture only', () => {
    const rows = buildSnapshotUrls(entries, {
      ignoreRules: [
        { type: 'url_pattern', url_pattern: '**/b/', applies_to: 'both' },
        { type: 'url_pattern', url_pattern: '**.pdf', applies_to: 'compare' },
        { type: 'url_pattern', url_pattern: '**/a/', viewport_slug: 'mobile' },
      ],
    });
    expect(rows.map((r) => r.included)).toEqual([true, false, true]);
    expect(snapshotCounts(rows, false)).toEqual({ urlCount: 2, redirectCount: 0, errorCount: 0 });
  });

  it('honours custom file extensions', () => {
    expect(
      buildSnapshotUrls([{ url: PDF, source: 'manual' }], { fileExtensions: ['zip'] })[0]?.kind,
    ).toBe('page');
  });
});

describe('formatSitemapTxt', () => {
  it('matches the prototype sitemap.txt: included URLs sorted, one per line, trailing newline', () => {
    expect(
      formatSitemapTxt([
        { url: B, included: true },
        { url: PDF, included: false },
        { url: A, included: true },
      ]),
    ).toBe(`${A}\n${B}\n`);
  });

  it('writes a lone newline for an empty list, like the prototype', () => {
    expect(formatSitemapTxt([])).toBe('\n');
  });
});

describe('diffSnapshotUrls', () => {
  it('lists added and removed URLs', () => {
    expect(diffSnapshotUrls([A, B], [B, PDF])).toEqual({ added: [PDF], removed: [A] });
  });
});
