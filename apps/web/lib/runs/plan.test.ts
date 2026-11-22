import type { IgnoreRule } from '@vrt/engine';
import { describe, expect, it } from 'vitest';
import { formatRunLabel, planRunItems, uniqueRunLabel, type SnapshotUrl } from './plan';

const urls: SnapshotUrl[] = [
  { url: 'https://example.com/b', kind: 'page' },
  { url: 'https://example.com/', kind: 'page' },
  { url: 'https://example.com/a/', kind: 'page' },
  { url: 'https://example.com/doc.pdf', kind: 'file' },
];

describe('run labels', () => {
  it('formats the UTC timestamp as YYYY-MM-DD_HH-MM-SS', () => {
    expect(formatRunLabel(new Date('2026-11-21T09:05:07.123Z'))).toBe('2026-11-21_09-05-07');
  });

  it('appends -2, -3… on collision', () => {
    const base = '2026-11-21_09-05-07';
    expect(uniqueRunLabel(base, [])).toBe(base);
    expect(uniqueRunLabel(base, [base])).toBe(`${base}-2`);
    expect(uniqueRunLabel(base, [base, `${base}-2`])).toBe(`${base}-3`);
  });
});

describe('planRunItems', () => {
  it('3 pages × 2 viewports + 1 file → 7 items; the file once, without a viewport', () => {
    const { items } = planRunItems({
      urls,
      viewports: ['desktop', 'mobile'],
      scope: 'all',
      ignoreRules: [],
    });
    expect(items).toHaveLength(7);
    expect(items.filter((i) => i.kind === 'file')).toEqual([
      {
        url: 'https://example.com/doc.pdf',
        kind: 'file',
        viewportSlug: null,
        filename: 'doc.pdf.png',
      },
    ]);
    expect(items.filter((i) => i.viewportSlug === 'mobile').map((i) => i.filename)).toEqual([
      'index.png',
      'a_.png',
      'b.png',
    ]);
  });

  it('scopes to pages or files only', () => {
    const base = { urls, viewports: ['desktop'], ignoreRules: [] };
    expect(planRunItems({ ...base, scope: 'pages' }).items).toHaveLength(3);
    expect(planRunItems({ ...base, scope: 'files' }).items.map((i) => i.url)).toEqual([
      'https://example.com/doc.pdf',
    ]);
  });

  it('custom scope captures the given URLs and reports unknown ones', () => {
    const plan = planRunItems({
      urls,
      viewports: ['desktop'],
      scope: 'custom',
      customUrls: ['https://example.com/b', 'https://other.test/x'],
      ignoreRules: [],
    });
    expect(plan.items.map((i) => i.url)).toEqual(['https://example.com/b']);
    expect(plan.unknownUrls).toEqual(['https://other.test/x']);
  });

  it('sample scope picks N URLs', () => {
    const plan = planRunItems({
      urls,
      viewports: ['desktop', 'mobile'],
      scope: 'sample',
      sample: 2,
      ignoreRules: [],
      random: () => 0,
    });
    expect(new Set(plan.items.map((i) => i.url)).size).toBe(2);
  });

  it('removes URLs matched by capture ignore rules, per viewport', () => {
    const rules: IgnoreRule[] = [
      { type: 'url_pattern', url_pattern: 'https://example.com/b', applies_to: 'capture' },
      { type: 'url_pattern', url_pattern: 'https://example.com/a/', viewport_slug: 'mobile' },
      { type: 'url_pattern', url_pattern: '**.pdf', applies_to: 'compare' },
    ];
    const { items } = planRunItems({
      urls,
      viewports: ['desktop', 'mobile'],
      scope: 'all',
      ignoreRules: rules,
    });
    expect(items.map((i) => `${i.viewportSlug}:${i.url}`)).toEqual([
      'desktop:https://example.com/',
      'mobile:https://example.com/',
      'desktop:https://example.com/a/',
      'null:https://example.com/doc.pdf',
    ]);
  });

  it('keeps a URL’s collision filename whatever subset is captured', () => {
    const colliding: SnapshotUrl[] = [
      { url: 'https://example.com/a?x', kind: 'page' },
      { url: 'https://example.com/a_x', kind: 'page' },
    ];
    const all = planRunItems({
      urls: colliding,
      viewports: ['desktop'],
      scope: 'all',
      ignoreRules: [],
    });
    expect(all.items.map((i) => i.filename)).toEqual(['a_x.png', 'a_x__2.png']);
    expect(all.collisions).toEqual([
      {
        url: 'https://example.com/a_x',
        filename: 'a_x__2.png',
        collidesWith: 'https://example.com/a?x',
      },
    ]);
    const subset = planRunItems({
      urls: colliding,
      viewports: ['desktop'],
      scope: 'custom',
      customUrls: ['https://example.com/a_x'],
      ignoreRules: [],
    });
    expect(subset.items[0]!.filename).toBe('a_x__2.png');
  });
});
