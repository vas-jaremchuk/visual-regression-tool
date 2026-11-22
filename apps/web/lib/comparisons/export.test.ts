import type { ReportItem } from '@vrt/engine';
import { describe, expect, it } from 'vitest';
import { RequestError } from '../members/errors';
import { exportComparisonHtml, type ExportComparison, type ExportGateway } from './export';

const BEFORE = '2026-11-01_10-00-00';
const AFTER = '2026-11-02_10-00-00';
const LABEL = `${BEFORE}_vs_${AFTER}`;

const comparison: ExportComparison = {
  id: 'cmp-a',
  projectId: 'project-a',
  projectName: 'Example site',
  label: LABEL,
  beforeLabel: BEFORE,
  afterLabel: AFTER,
  changeThresholdPct: 0.05,
  publicUrl: null,
  bucket: 'vrt-a',
};

const items: ReportItem[] = [
  {
    url: 'https://www.example.com/about',
    name: 'about',
    kind: 'page',
    viewport_slug: 'desktop',
    status: 'changed',
    diff_pct: 3.5,
    diff_pixels: 35,
    total_pixels: 1000,
    before_key: `screenshots/${BEFORE}/desktop/about.png`,
    after_key: `screenshots/${AFTER}/desktop/about.png`,
    diff_key: `diffs/${LABEL}/desktop/about.png`,
    review: 'pending',
  },
  {
    url: 'https://www.example.com/',
    name: 'home',
    kind: 'page',
    viewport_slug: 'desktop',
    status: 'unchanged',
  },
];

function gateway(overrides: Partial<ExportComparison> = {}, options: { role?: boolean } = {}) {
  const signed: { bucket: string; key: string; ttl: number }[] = [];
  const g: ExportGateway = {
    loadComparison: async (id) => (id === comparison.id ? { ...comparison, ...overrides } : null),
    assertCan: async (action) => {
      if (options.role === false) throw new RequestError(403, 'forbidden', action);
    },
    listItems: async () => items,
    presignGet: async (bucket, key, ttl) => {
      signed.push({ bucket, key, ttl });
      return `https://acct.r2.cloudflarestorage.com/${bucket}/${key}?X-Amz-Signature=s&X-Amz-Expires=${ttl}`;
    },
  };
  return { g, signed };
}

function imageSources(html: string): string[] {
  return [...html.matchAll(/<img src="([^"]*)"/g)].map((m) => m[1]!);
}

describe('exportComparisonHtml', () => {
  it('uses absolute public URLs when the project has one, and signs nothing', async () => {
    const { g, signed } = gateway({ publicUrl: 'https://pub.example.com/' });
    const { filename, html } = await exportComparisonHtml(g, 'cmp-a');
    expect(filename).toBe(`${LABEL}.html`);
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(imageSources(html)).toEqual([
      `https://pub.example.com/screenshots/${BEFORE}/desktop/about.png`,
      `https://pub.example.com/diffs/${LABEL}/desktop/about.png`,
      `https://pub.example.com/screenshots/${AFTER}/desktop/about.png`,
    ]);
    expect(signed).toEqual([]);
  });

  it('uses absolute presigned URLs valid for 7 days without a public URL', async () => {
    const { g, signed } = gateway();
    const { html } = await exportComparisonHtml(g, 'cmp-a');
    const sources = imageSources(html);
    expect(sources).toHaveLength(3);
    for (const src of sources) {
      expect(src).toMatch(/^https:\/\/acct\.r2\.cloudflarestorage\.com\/vrt-a\//);
      // Nothing that needs the app or a session: the file works offline from disk.
      expect(src).not.toContain('/api/');
    }
    expect(signed.map((s) => s.ttl)).toEqual([604800, 604800, 604800]);
    expect(html).toContain('Example site');
    expect(html).not.toMatch(/<script/i);
  });

  it('never signs keys outside the comparison', async () => {
    const { g, signed } = gateway();
    const foreign: ReportItem = {
      ...items[0]!,
      before_key: 'screenshots/2026-10-01_10-00-00/desktop/about.png',
    };
    await exportComparisonHtml({ ...g, listItems: async () => [foreign] }, 'cmp-a');
    expect(signed.map((s) => s.key)).not.toContain(foreign.before_key);
  });

  it('answers 404 for a comparison the user cannot see and 403 without view permission', async () => {
    await expect(exportComparisonHtml(gateway().g, 'cmp-b')).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      exportComparisonHtml(gateway({}, { role: false }).g, 'cmp-a'),
    ).rejects.toMatchObject({ status: 403 });
  });
});
